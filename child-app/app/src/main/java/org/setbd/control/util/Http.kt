package org.setbd.control.util

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/** OkHttp singleton + small synchronous JSON helpers (call from Dispatchers.IO). */
object Http {
    val JSON = "application/json; charset=utf-8".toMediaType()

    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS)
        .writeTimeout(25, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    class HttpException(val status: Int, val code: String, message: String) : Exception(message)

    fun get(url: String, deviceToken: String): String {
        val req = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $deviceToken")
            .build()
        return exec(req)
    }

    fun post(url: String, deviceToken: String?, body: String, authorizedAsParent: Boolean = false): String {
        val builder = Request.Builder().url(url)
        if (deviceToken != null) builder.header("Authorization", "Bearer $deviceToken")
        builder.post(body.toRequestBody(JSON))
        return exec(builder.build())
    }

    private fun exec(request: Request): String {
        client.newCall(request).execute().use { res ->
            val text = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                throw HttpException(res.code, "http_${res.code}", text.ifBlank { "HTTP ${res.code}" })
            }
            return text
        }
    }
}
