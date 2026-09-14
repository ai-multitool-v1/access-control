package org.setbd.control.monitoring

import android.content.ContentUris
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import org.setbd.control.permissions.PermissionManager
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream

/**
 * On-device file browser + preview relay for the parent dashboard.
 *
 * PRIVACY/STORAGE CONTRACT: nothing is stored server-side. The parent asks
 * for a directory listing or a single preview through the realtime command
 * channel; bytes are downscaled/streamed straight through the WebSocket and
 * dropped. Large payloads are sent in base64 chunks (reassembled by the DO).
 */
object FileBrowserProvider {

    private const val MAX_PREVIEW_BYTES = 512 * 1024      // raw bytes for non-image files
    private const val MAX_IMAGE_PX = 1280                 // images are downscaled to this edge
    private const val IMAGE_JPEG_QUALITY = 80

    private val TEXT_EXT = setOf("txt", "log", "json", "xml", "csv", "md", "html", "htm", "ini", "cfg")
    private val IMAGE_EXT = setOf("jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif")
    private val VIDEO_EXT = setOf("mp4", "mkv", "webm", "3gp", "mov", "avi")
    private val AUDIO_EXT = setOf("mp3", "ogg", "m4a", "wav", "flac", "aac", "amr")

    fun available(ctx: Context): Boolean = PermissionManager.storageGranted(ctx)

    /** True when direct File API access is possible (All Files Access). */
    private fun directAccess(ctx: Context): Boolean = PermissionManager.allFilesAccessGranted(ctx)

    // ------------------------------------------------------------------
    // Directory listing
    // ------------------------------------------------------------------

    /**
     * List one directory of the shared storage. `dirPath` is a relative path
     * like "" (root), "Download/", "DCIM/Camera/". Returns {path, dirs, files}.
     * With All-Files-Access the raw File API is used so EVERY file (documents,
     * PDFs, audio, archives) shows up — MediaStore only exposes media on
     * Android 13+ and used to leave the parent able to see folders but unable
     * to open the data inside them.
     */
    fun listDir(ctx: Context, dirPath: String): JSONObject {
        val dir = dirPath.trim('/').let { if (it.isEmpty()) "" else "$it/" }
        if (directAccess(ctx)) {
            val viaFile = listDirDirect(ctx, dir)
            if (viaFile != null) return viaFile
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return listDirMediaStore(ctx, dir)
        }
        return listDirLegacy(ctx, dir)
    }

    /** Raw File API listing (All Files Access). */
    private fun listDirDirect(ctx: Context, dir: String): JSONObject? = try {
        val root = File(Environment.getExternalStorageDirectory(), dir)
        if (!root.exists() || !root.canRead()) null
        else {
            val dirs = LinkedHashSet<String>()
            val files = JSONArray()
            val children = root.listFiles()
                ?.sortedByDescending { it.lastModified() }
                ?: emptyList()
            for (f in children) {
                if (f.isDirectory) {
                    dirs.add(f.name)
                    if (dirs.size >= 100) break
                } else {
                    val mime = mimeFor(f.name)
                    files.put(
                        JSONObject()
                            .put("name", f.name.take(200))
                            .put("path", dir)
                            .put("size", f.length())
                            .put("mime", mime)
                            .put("kind", kindOf(f.name, mime))
                            .put("modified", f.lastModified())
                            .put("mediaId", JSONObject.NULL)
                    )
                    if (files.length() >= 400) break
                }
            }
            JSONObject()
                .put("path", dir)
                .put("dirs", JSONArray(dirs.toList().sorted().take(100)))
                .put("files", files)
                .put("source", "direct")
        }
    } catch (e: Exception) {
        null
    }

    private fun listDirMediaStore(ctx: Context, dir: String): JSONObject {
        val dirs = LinkedHashSet<String>()
        val files = JSONArray()
        if (!available(ctx)) {
            return JSONObject().put("path", dir).put("dirs", JSONArray()).put("files", files)
                .put("permissionMissing", true)
        }
        val projection = arrayOf(
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.RELATIVE_PATH,
            MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.MediaColumns.DATE_MODIFIED,
        )
        try {
            ctx.contentResolver.query(
                MediaStore.Files.getContentUri("external"),
                projection,
                null,
                null,
                "${MediaStore.MediaColumns.DATE_MODIFIED} DESC"
            )?.use { c ->
                val nameC = c.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
                val pathC = c.getColumnIndexOrThrow(MediaStore.MediaColumns.RELATIVE_PATH)
                val sizeC = c.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE)
                val mimeC = c.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE)
                val modC = c.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_MODIFIED)
                val idC = c.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
                var scanned = 0
                while (c.moveToNext() && scanned < 20_000) {
                    scanned++
                    val rel = c.getString(pathC) ?: continue
                    if (!rel.startsWith(dir)) continue
                    val rest = rel.removePrefix(dir)
                    if (rest.isEmpty()) continue
                    val slash = rest.indexOf('/')
                    if (slash >= 0) {
                        // entry inside a sub-directory of `dir` → surface the folder
                        dirs.add(rest.substring(0, slash))
                        continue
                    }
                    val name = c.getString(nameC) ?: continue
                    val mime = c.getString(mimeC) ?: mimeFor(name)
                    files.put(
                        JSONObject()
                            .put("name", name.take(200))
                            .put("path", dir)
                            .put("size", c.getLong(sizeC))
                            .put("mime", mime.take(100))
                            .put("kind", kindOf(name, mime))
                            .put("modified", c.getLong(modC) * 1000)
                            .put("mediaId", "file_${c.getLong(idC)}")
                    )
                    if (files.length() >= 400) break
                }
            }
        } catch (e: Exception) {
            // MediaStore.Files unavailable — return whatever we have
        }
        return JSONObject()
            .put("path", dir)
            .put("dirs", JSONArray(dirs.toList().sorted().take(100)))
            .put("files", files)
    }

    private fun listDirLegacy(ctx: Context, dir: String): JSONObject {
        val dirs = JSONArray()
        val files = JSONArray()
        if (!available(ctx)) {
            return JSONObject().put("path", dir).put("dirs", dirs).put("files", files)
                .put("permissionMissing", true)
        }
        try {
            val root = File(Environment.getExternalStorageDirectory(), dir)
            val children = root.listFiles() ?: return JSONObject()
                .put("path", dir).put("dirs", dirs).put("files", files)
            val sorted = children.sortedByDescending { it.lastModified() }
            for (f in sorted) {
                if (f.isDirectory) {
                    dirs.put(f.name)
                    if (dirs.length() >= 100) break
                } else {
                    val mime = mimeFor(f.name)
                    files.put(
                        JSONObject()
                            .put("name", f.name.take(200))
                            .put("path", dir)
                            .put("size", f.length())
                            .put("mime", mime)
                            .put("kind", kindOf(f.name, mime))
                            .put("modified", f.lastModified())
                            .put("mediaId", JSONObject.NULL)
                    )
                    if (files.length() >= 400) break
                }
            }
        } catch (e: Exception) {
            // unreadable directory — return empty
        }
        return JSONObject().put("path", dir).put("dirs", dirs).put("files", files)
    }

    // ------------------------------------------------------------------
    // Single-file preview
    // ------------------------------------------------------------------

    /**
     * Preview one item: `mediaId` ("image_12", "video_9" from the gallery
     * index, "file_88" from listDir) or a relative `path` + `name`.
     * Images and video frames are downscaled; other files are truncated to
     * 512 KB. Returns the response payload (data field may be chunked by the
     * caller when huge).
     */
    fun preview(ctx: Context, mediaId: String?, path: String?, name: String?): JSONObject? {
        if (!available(ctx)) {
            return JSONObject().put("error", "missing_permission")
        }
        // 1. mediaId forms (MediaStore ids from the gallery index / listings)
        when {
            mediaId?.startsWith("image_") == true ->
                return previewImage(ctx, ContentUris.withAppendedId(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    mediaId.removePrefix("image_").toLongOrNull() ?: return null))
            mediaId?.startsWith("video_") == true ->
                return previewVideo(ctx, ContentUris.withAppendedId(
                    MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                    mediaId.removePrefix("video_").toLongOrNull() ?: return null))
            mediaId?.startsWith("file_") == true && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ->
                previewMediaStoreFile(ctx, mediaId.removePrefix("file_").toLongOrNull() ?: return null)
                ?.let { return it }
        }
        // 2. Direct File API (All Files Access) — reads ANY file's data.
        if (directAccess(ctx)) {
            val rel = (path ?: "").trim('/')
            val n = name ?: mediaId?.takeIf { !it.startsWith("file_") }
            if (n != null) {
                val f = File(Environment.getExternalStorageDirectory(), if (rel.isEmpty()) n else "$rel/$n")
                if (f.exists() && f.canRead()) {
                    val viaFile = previewFileDirect(ctx, f)
                    if (viaFile != null) return viaFile
                }
            }
        }
        // 3. Resolve by relative path + name via MediaStore (legacy builds / no AFA).
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val rel = (path ?: "").trim('/')
            val display = name ?: return null
            val uri = findMediaStoreByPath(ctx, if (rel.isEmpty()) "" else "$rel/", display)
                ?: return null
            previewUri(ctx, uri)
        } else {
            val f = File(Environment.getExternalStorageDirectory(), "${path?.trim('/') ?: ""}/$name")
            if (!f.exists()) null else previewUri(ctx, Uri.fromFile(f))
        }
    }

    private fun previewMediaStoreFile(ctx: Context, id: Long): JSONObject? =
        previewUri(ctx, ContentUris.withAppendedId(MediaStore.Files.getContentUri("external"), id))

    /** Direct file read (All Files Access): images/videos get previews, text
     *  files get inline content, everything else is sent truncated as bytes. */
    private fun previewFileDirect(ctx: Context, f: File): JSONObject? {
        return try {
            val ext = f.extension.lowercase()
            when {
                ext in IMAGE_EXT -> previewImage(ctx, Uri.fromFile(f))
                ext in VIDEO_EXT -> previewVideo(ctx, Uri.fromFile(f))
                else -> {
                    val bytes = try {
                        f.inputStream().use { readUpTo(it, MAX_PREVIEW_BYTES) }
                    } catch (e: Exception) {
                        null
                    } ?: return null
                    val total = f.length()
                    val data = Base64.encodeToString(bytes, Base64.NO_WRAP)
                    JSONObject()
                        .put("mime", if (ext in TEXT_EXT) "text/plain" else mimeFor(f.name))
                        .put("kind", if (ext in TEXT_EXT) "text" else "file")
                        .put("name", f.name.take(200))
                        .put("sizeBytes", bytes.size)
                        .put("totalSize", total)
                        .put("truncated", total > bytes.size)
                        .put("data", data)
                }
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun findMediaStoreByPath(ctx: Context, dir: String, name: String): Uri? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
        return try {
            ctx.contentResolver.query(
                MediaStore.Files.getContentUri("external"),
                arrayOf(MediaStore.MediaColumns._ID),
                "${MediaStore.MediaColumns.RELATIVE_PATH}=? AND ${MediaStore.MediaColumns.DISPLAY_NAME}=?",
                arrayOf(dir, name),
                null
            )?.use { c ->
                if (c.moveToFirst()) ContentUris.withAppendedId(
                    MediaStore.Files.getContentUri("external"), c.getLong(0)
                ) else null
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun previewImage(ctx: Context, uri: Uri): JSONObject {
        val bmp: Bitmap? = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ctx.contentResolver.loadThumbnail(uri, android.util.Size(MAX_IMAGE_PX, MAX_IMAGE_PX), null)
            } else null
        } catch (e: Exception) {
            null
        } ?: decodeScaled(ctx, uri)

        val out = ByteArrayOutputStream()
        val ok = bmp?.compress(Bitmap.CompressFormat.JPEG, IMAGE_JPEG_QUALITY, out) == true
        if (!ok) return JSONObject().put("error", "decode_failed")

        val data = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        return JSONObject()
            .put("mime", "image/jpeg")
            .put("kind", "image")
            .put("name", "preview.jpg")
            .put("sizeBytes", out.size())
            .put("truncated", false)
            .put("data", data)
    }

    private fun previewVideo(ctx: Context, uri: Uri): JSONObject {
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(ctx, uri)
            val durationMs = runCatching {
                retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
            }.getOrNull() ?: -1L
            val frame = runCatching {
                retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
            }.getOrNull()
            val scaled = frame?.let { scaleDown(it, MAX_IMAGE_PX) }
            val out = ByteArrayOutputStream()
            val ok = scaled?.compress(Bitmap.CompressFormat.JPEG, IMAGE_JPEG_QUALITY, out) == true
            if (!ok) return JSONObject().put("error", "frame_failed")
            val data = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
            JSONObject()
                .put("mime", "video/poster")
                .put("kind", "video")
                .put("name", "video-frame.jpg")
                .put("sizeBytes", out.size())
                .put("durationMs", durationMs)
                .put("truncated", false)
                .put("data", data)
        } catch (e: Exception) {
            JSONObject().put("error", "video_failed")
        } finally {
            runCatching { retriever.release() }
        }
    }

    private fun previewUri(ctx: Context, uri: Uri): JSONObject? {
        val name = queryName(ctx, uri) ?: "file"
        val mime = queryMime(ctx, uri) ?: mimeFor(name)
        val ext = name.substringAfterLast('.', "").lowercase()
        return when {
            ext in IMAGE_EXT -> previewImage(ctx, uri)
            ext in VIDEO_EXT -> previewVideo(ctx, uri)
            else -> {
                // Text / pdf / binary → raw bytes (truncated).
                val bytes = try {
                    ctx.contentResolver.openInputStream(uri)?.use { ins ->
                        readUpTo(ins, MAX_PREVIEW_BYTES)
                    }
                } catch (e: Exception) {
                    null
                } ?: return null
                val total = querySize(ctx, uri)
                val data = Base64.encodeToString(bytes, Base64.NO_WRAP)
                JSONObject()
                    .put("mime", if (ext in TEXT_EXT) "text/plain" else mime.take(100))
                    .put("kind", if (ext in TEXT_EXT) "text" else "file")
                    .put("name", name.take(200))
                    .put("sizeBytes", bytes.size)
                    .put("totalSize", total)
                    .put("truncated", total > bytes.size)
                    .put("data", data)
            }
        }
    }

    // ------------------------------------------------------------------
    // Chunked whole-file read (browser playback + parent downloads)
    // ------------------------------------------------------------------

    /**
     * Stream one slice of a file, addressed by normalized [offset]. The parent
     * loops until `eof` — this keeps every WebSocket message small (chunks are
     * further split by RealtimeService and reassembled by the Durable Object)
     * and gives the dashboard a real progress bar.
     *
     * Resolution order mirrors preview(): direct File API (All Files Access)
     * first, then the mediaId MediaStore forms, then path+name lookup.
     */
    fun readChunk(
        ctx: Context,
        mediaId: String?,
        path: String?,
        name: String?,
        offset: Long,
        maxBytes: Int
    ): JSONObject? {
        if (!available(ctx)) return JSONObject().put("error", "missing_permission")
        val resolved = resolveReadStream(ctx, mediaId, path, name) ?: return null
        val (stream, total, display) = resolved
        return try {
            // Consume `offset` bytes (FileInputStream.skip seeks natively; the
            // loop also covers streams whose skip() advances less than asked).
            var toSkip = offset
            while (toSkip > 0) {
                val s = stream.skip(toSkip)
                if (s > 0) {
                    toSkip -= s
                } else {
                    if (stream.read() < 0) break else toSkip -= 1
                }
            }
            val bytes = readUpTo(stream, maxBytes)
            val mime = mimeFor(display)
            JSONObject()
                .put("name", display.take(200))
                .put("mime", mime)
                .put("kind", kindOf(display, mime))
                .put("totalSize", if (total >= 0) total else offset + bytes.size)
                .put("offset", offset)
                .put("sizeBytes", bytes.size)
                .put("eof", bytes.size < maxBytes || (total >= 0 && offset + bytes.size >= total))
                .put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
        } catch (e: Exception) {
            JSONObject().put("error", "read_failed")
        } finally {
            runCatching { stream.close() }
        }
    }

    /** Open a raw byte stream for ANY supported address form. */
    private fun resolveReadStream(
        ctx: Context,
        mediaId: String?,
        path: String?,
        name: String?
    ): Triple<InputStream, Long, String>? {
        // 1. Direct File API (All Files Access) — every extension, real size.
        if (directAccess(ctx)) {
            val rel = (path ?: "").trim('/')
            val n = name ?: mediaId?.takeIf {
                !it.startsWith("file_") && !it.startsWith("image_") && !it.startsWith("video_")
            }
            if (n != null) {
                val f = File(Environment.getExternalStorageDirectory(), if (rel.isEmpty()) n else "$rel/$n")
                if (f.exists() && f.canRead()) {
                    return Triple(f.inputStream(), f.length(), f.name)
                }
            }
        }
        // 2. MediaStore numeric ids ("image_12", "video_9", "file_88").
        val numeric = mediaId
            ?.takeIf { it.startsWith("file_") || it.startsWith("image_") || it.startsWith("video_") }
            ?.substringAfter('_')?.toLongOrNull()
        if (numeric != null && numeric >= 0 && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                val uri = ContentUris.withAppendedId(MediaStore.Files.getContentUri("external"), numeric)
                val ins = ctx.contentResolver.openInputStream(uri)
                if (ins != null) {
                    val display = (name ?: queryName(ctx, uri) ?: "file")
                    return Triple(ins, querySize(ctx, uri), display)
                }
            } catch (e: Exception) {
                // fall through to path lookup
            }
        }
        // 3. Relative path + name via MediaStore (Q+) or plain File (legacy).
        val rel = (path ?: "").trim('/')
        val display = name ?: return null
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val uri = findMediaStoreByPath(ctx, if (rel.isEmpty()) "" else "$rel/", display) ?: return null
            val ins = ctx.contentResolver.openInputStream(uri) ?: return null
            Triple(ins, querySize(ctx, uri), display)
        } else {
            val f = File(Environment.getExternalStorageDirectory(), "${rel}/$display")
            if (!f.exists() || !f.canRead()) null else Triple(f.inputStream(), f.length(), f.name)
        }
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    private fun decodeScaled(ctx: Context, uri: Uri): Bitmap? = try {
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
        var sample = 1
        while (maxOf(opts.outWidth, opts.outHeight) / sample > MAX_IMAGE_PX * 2) sample *= 2
        val o2 = BitmapFactory.Options().apply { inSampleSize = sample }
        ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, o2) }
    } catch (e: Exception) {
        null
    }

    private fun scaleDown(bmp: Bitmap, maxPx: Int): Bitmap {
        val edge = maxOf(bmp.width, bmp.height)
        if (edge <= maxPx) return bmp
        val scale = maxPx.toFloat() / edge
        return Bitmap.createScaledBitmap(
            bmp, (bmp.width * scale).toInt().coerceAtLeast(1), (bmp.height * scale).toInt().coerceAtLeast(1), true
        )
    }

    private fun readUpTo(ins: InputStream, max: Int): ByteArray {
        val out = ByteArrayOutputStream(minOf(max, 64 * 1024))
        val buf = ByteArray(16 * 1024)
        while (out.size() < max) {
            val read = ins.read(buf)
            if (read <= 0) break
            val take = minOf(read, max - out.size())
            out.write(buf, 0, take)
        }
        return out.toByteArray()
    }

    private fun queryName(ctx: Context, uri: Uri): String? = try {
        ctx.contentResolver.query(uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) it.getString(0) else null
        } ?: uri.lastPathSegment
    } catch (e: Exception) {
        uri.lastPathSegment
    }

    private fun queryMime(ctx: Context, uri: Uri): String? = try {
        ctx.contentResolver.query(uri, arrayOf(MediaStore.MediaColumns.MIME_TYPE), null, null, null)?.use {
            if (it.moveToFirst()) it.getString(0) else null
        }
    } catch (e: Exception) {
        null
    }

    private fun querySize(ctx: Context, uri: Uri): Long = try {
        ctx.contentResolver.query(uri, arrayOf(MediaStore.MediaColumns.SIZE), null, null, null)?.use {
            if (it.moveToFirst()) it.getLong(0) else 0L
        } ?: 0L
    } catch (e: Exception) {
        0L
    }

    fun mimeFor(name: String): String {
        val ext = name.substringAfterLast('.', "").lowercase()
        return when {
            ext in IMAGE_EXT -> "image/*"
            ext in VIDEO_EXT -> "video/*"
            ext in AUDIO_EXT -> "audio/*"
            ext == "pdf" -> "application/pdf"
            ext in TEXT_EXT -> "text/plain"
            ext == "apk" -> "application/vnd.android.package-archive"
            else -> "application/octet-stream"
        }
    }

    private fun kindOf(name: String, mime: String): String = when {
        mime.startsWith("image/") -> "image"
        mime.startsWith("video/") -> "video"
        mime.startsWith("audio/") -> "audio"
        else -> {
            val ext = name.substringAfterLast('.', "").lowercase()
            when {
                ext in IMAGE_EXT -> "image"
                ext in VIDEO_EXT -> "video"
                ext in AUDIO_EXT -> "audio"
                ext in TEXT_EXT -> "text"
                ext == "pdf" -> "pdf"
                else -> "file"
            }
        }
    }
}
