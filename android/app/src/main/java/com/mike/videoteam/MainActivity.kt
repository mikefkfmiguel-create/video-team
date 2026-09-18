package com.mike.videoteam

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import org.json.JSONObject

class MainActivity : Activity() {

    companion object {
        const val HOST = "7eventos.avk.pt"
        const val START = "http://$HOST/7Eventos/EscalasTecnicos/GetPeriodoJS"
    }

    private lateinit var web: WebView
    private lateinit var loginJs: String
    private lateinit var appJs: String
    private var loginAttempts = 0

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        loginJs = assets.open("login.js").bufferedReader().use { it.readText() }
        appJs = assets.open("app.js").bufferedReader().use { it.readText() }

        web = WebView(this)
        setContentView(web)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        CookieManager.getInstance().setAcceptCookie(true)

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                if (req.url.host == HOST) return false
                startActivity(Intent(Intent.ACTION_VIEW, req.url))
                return true
            }

            override fun onPageFinished(view: WebView, url: String) = onPage(url)

            override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
                if (!req.isForMainFrame) return
                view.loadDataWithBaseURL(
                    "http://$HOST/", offlineHtml(err.description.toString()), "text/html", "utf-8", null
                )
            }
        }

        web.loadUrl(START)
    }

    private fun onPage(url: String) {
        val path = Uri.parse(url).path ?: ""
        when {
            path.contains("/Account/Login", ignoreCase = true) -> {
                if (loginAttempts >= 2) return
                val cfg = JSONObject().put("user", BuildConfig.VT_USER).put("password", BuildConfig.VT_PASSWORD)
                web.evaluateJavascript("($loginJs)($cfg)") { res ->
                    when (res?.trim('"')) {
                        "submitted" -> loginAttempts++
                        "loginerror" -> {
                            loginAttempts = 2
                            Toast.makeText(this, "Login falhou. Confirma o user/password no secrets.properties.", Toast.LENGTH_LONG).show()
                        }
                    }
                }
            }
            url.startsWith(START) -> {
                loginAttempts = 0
                val cfg = JSONObject().put("search", BuildConfig.VT_SEARCH)
                web.evaluateJavascript("($appJs)($cfg)", null)
            }
        }
    }

    private fun offlineHtml(desc: String) = """
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <body style="font:16px system-ui;padding:48px 24px;text-align:center;color:#666">
        <h2 style="color:#222">Sem ligação ao 7Eventos</h2><p>${desc.replace("<", "&lt;")}</p>
        <button onclick="location.href='$START'" style="font:inherit;padding:10px 20px;border-radius:8px;border:0;background:#c8102e;color:#fff">Tentar de novo</button>
        </body>
    """.trimIndent()

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // fecha o painel de detalhe se estiver aberto, senao sai
        web.evaluateJavascript(
            "(function(){var s=document.getElementById('sheet');if(s&&s.classList.contains('open')){s.classList.remove('open');return 1}return 0})()"
        ) { r -> if (r != "1") runOnUiThread { @Suppress("DEPRECATION") super.onBackPressed() } }
    }
}
