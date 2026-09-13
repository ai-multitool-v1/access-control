package org.setbd.control.monitoring

import android.content.ContentUris
import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Base64
import android.util.LruCache
import org.json.JSONArray
import org.json.JSONObject
import org.setbd.control.storage.SecureStore
import org.setbd.control.permissions.PermissionManager
import org.setbd.control.util.Http
import org.setbd.control.BuildConfig
import java.io.ByteArrayOutputStream
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Photo / video lookup for the parent dashboard.
 * Indexes MediaStore (images + videos): name, album, date, size — plus a tiny
 * 96px JPEG thumbnail. Only the INDEX leaves the device; full media files are
 * never uploaded. Stored results are capped so the parent sees the newest 600
 * items per device.
 */
object MediaProvider {

    private const val MAX_ITEMS = 120          // per upload batch
    private const val THUMB_PX = 96
    private val syncing = AtomicBoolean(false)

    /** Process-lifetime thumbnail memory cache (keys = media id). */
    private val memCache = object : LruCache<String, String>(64) {}

    /** Epoch ms of the last successful index upload (runtime prefs). */
    fun lastSyncAt(ctx: Context): Long =
        ctx.getSharedPreferences("ac_runtime", Context.MODE_PRIVATE).getLong("media_synced_at", 0L)

    private fun markSynced(ctx: Context) {
        ctx.getSharedPreferences("ac_runtime", Context.MODE_PRIVATE)
            .edit().putLong("media_synced_at", System.currentTimeMillis()).apply()
    }

    /** True when MediaStore can be queried (storage permission granted). */
    fun available(ctx: Context): Boolean = PermissionManager.storageGranted(ctx)

    /**
     * Full index sync: newest-first, up to 600 items, uploaded in batches.
     * Returns the number of items stored server-side.
     */
    fun syncNow(ctx: Context): Int {
        if (!syncing.compareAndSet(false, true)) return -1
        return try {
            if (!SecureStore.isPaired || !available(ctx)) return 0
            val items = indexMedia(ctx)
            var stored = 0
            for (chunk in items.chunked(MAX_ITEMS)) {
                val body = JSONObject().put("items", chunk)
                val res = post(ctx, "/api/media/sync", body)
                if (res == null) break
                stored += res.optInt("stored", 0)
            }
            if (stored >= 0) markSynced(ctx)
            stored
        } catch (e: Exception) {
            -1
        } finally {
            syncing.set(false)
        }
    }

    /** MediaStore query → list of JSON items (newest first). */
    fun indexMedia(ctx: Context): List<JSONObject> {
        val out = ArrayList<JSONObject>(256)
        out += queryCollection(
            ctx,
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            kind = "image",
            dateCol = MediaStore.Images.Media.DATE_TAKEN,
            fallbackDateCol = MediaStore.Images.Media.DATE_ADDED
        )
        out += queryCollection(
            ctx,
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
            kind = "video",
            dateCol = MediaStore.Video.Media.DATE_TAKEN,
            fallbackDateCol = MediaStore.Video.Media.DATE_ADDED
        )
        out.sortByDescending { it.optLong("takenAt", 0L) }
        return out.take(600)
    }

    private fun queryCollection(
        ctx: Context,
        collection: Uri,
        kind: String,
        dateCol: String,
        fallbackDateCol: String
    ): List<JSONObject> {
        val list = ArrayList<JSONObject>(128)
        val projection = arrayOf(
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.BUCKET_DISPLAY_NAME,
            MediaStore.MediaColumns.SIZE,
            dateCol,
            fallbackDateCol,
        )
        try {
            ctx.contentResolver.query(collection, projection, null, null, "$dateCol DESC")?.use { c ->
                val idC = c.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
                val nameC = c.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
                val albumC = c.getColumnIndexOrThrow(MediaStore.MediaColumns.BUCKET_DISPLAY_NAME)
                val sizeC = c.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE)
                val dateC = c.getColumnIndex(dateCol)
                val fbC = c.getColumnIndex(fallbackDateCol)
                while (c.moveToNext() && list.size < 400) {
                    val id = c.getLong(idC)
                    val name = c.getString(nameC) ?: "media_$id"
                    val album = c.getString(albumC) ?: ""
                    val size = c.getLong(sizeC)
                    val takenSec = if (dateC >= 0) c.getLong(dateC) else 0L
                    val fbSec = if (fbC >= 0) c.getLong(fbC) else 0L
                    val takenMs = if (takenSec > 0) takenSec * 1000 else fbSec * 1000
                    list.add(
                        JSONObject()
                            .put("mediaId", "${kind}_$id")
                            .put("kind", kind)
                            .put("label", name.take(200))
                            .put("album", album.take(160))
                            .put("takenAt", takenMs)
                            .put("sizeBytes", size)
                    )
                }
            }
        } catch (e: Exception) {
            // collection unavailable on this device — skip it
        }
        return list
    }

    /**
     * Tiny JPEG thumbnail (base64, no data: prefix) for a media id.
     * Images come from MediaStore Thumbnails via loadThumbnail; videos use the
     * embedded frame. Cached in memory.
     */
    fun thumbnailB64(ctx: Context, mediaId: String): String? {
        memCache.get(mediaId)?.let { return it }
        if (!available(ctx)) return null
        val kind = if (mediaId.startsWith("video_")) "video" else "image"
        val rawId = mediaId.removePrefix("${kind}_").toLongOrNull() ?: return null
        val collection = if (kind == "video") MediaStore.Video.Media.EXTERNAL_CONTENT_URI
        else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        val uri = ContentUris.withAppendedId(collection, rawId)
        val bmp: Bitmap? = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ctx.contentResolver.loadThumbnail(uri, android.util.Size(THUMB_PX, THUMB_PX), null)
            } else null
        } catch (e: Exception) {
            null
        } ?: try {
            if (kind == "video") {
                // Pre-Q fallback: grab a video frame without deprecated helpers.
                val retriever = MediaMetadataRetriever()
                retriever.setDataSource(ctx, uri)
                val frame = runCatching { retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC) }.getOrNull()
                runCatching { retriever.release() }
                frame
            } else null
        } catch (e: Exception) {
            null
        }
        val encoded = bmp?.let { b ->
            val scaled = if (b.width > THUMB_PX * 2 || b.height > THUMB_PX * 2) {
                Bitmap.createScaledBitmap(b, THUMB_PX, THUMB_PX * b.height / b.width, true)
            } else b
            val out = ByteArrayOutputStream()
            scaled.compress(Bitmap.CompressFormat.JPEG, 60, out)
            Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        }
        if (encoded != null) memCache.put(mediaId, encoded)
        return encoded
    }

    private fun post(ctx: Context, path: String, body: JSONObject): JSONObject? {
        return try {
            val token = SecureStore.deviceToken ?: return null
            val text = Http.post("${BuildConfig.API_BASE}$path", token, body.toString())
            JSONObject(text)
        } catch (e: Exception) {
            null
        }
    }
}
