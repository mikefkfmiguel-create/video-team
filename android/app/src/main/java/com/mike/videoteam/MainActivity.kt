package com.mike.videoteam

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.ContactsContract
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.view.ViewGroup
import android.view.WindowInsets
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.text.Normalizer

class MainActivity : Activity() {

    companion object {
        const val HOST = "7eventos.avk.pt"
        const val START = "http://$HOST/7Eventos/EscalasTecnicos/GetPeriodoJS"
        const val SALAS_API = "https://videoteam-api.mike-app.com"
        const val WEB_BASE = "https://videoteam.mike-app.com/"      // onde abrem os links de evento (?p=...)
        const val PEDIDO_CONTACTOS = 4242
        const val MAX_CONTACTOS = 3000
        const val MAX_BUSCA = 40
    }

    private lateinit var web: WebView
    private lateinit var loginJs: String
    private lateinit var appJs: String
    private lateinit var salasJs: String
    private var loginAttempts = 0
    @Volatile private var paginaDoHost = false     // a ponte so responde enquanto a pagina aberta for a do 7Eventos

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        loginJs = assets.open("login.js").bufferedReader().use { it.readText() }
        appJs = assets.open("app.js").bufferedReader().use { it.readText() }
        // editor «Equipa por sala» (motor + ecra), carregado antes do app.js
        salasJs = assets.open("salas-motor.js").bufferedReader().use { it.readText() } + "\n;" +
            assets.open("salas.js").bufferedReader().use { it.readText() } + "\n;" +
            assets.open("chat.js").bufferedReader().use { it.readText() }   // chat do evento (ecra do dono)

        web = WebView(this)
        // Android 15+ (targetSdk 35): a app desenha por baixo da barra de estado e da barra de navegacao. A pagina fica entre elas
        // (e acima do teclado), com o fundo do tema a encher o resto.
        val raiz = FrameLayout(this)
        raiz.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        raiz.setOnApplyWindowInsetsListener { v, insets ->
            val e: Int; val t: Int; val d: Int; val b: Int
            if (Build.VERSION.SDK_INT >= 30) {
                val barras = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                val teclado = insets.getInsets(WindowInsets.Type.ime())
                e = barras.left; t = barras.top; d = barras.right; b = maxOf(barras.bottom, teclado.bottom)
            } else {
                @Suppress("DEPRECATION")
                run { e = insets.systemWindowInsetLeft; t = insets.systemWindowInsetTop; d = insets.systemWindowInsetRight; b = insets.systemWindowInsetBottom }
            }
            v.setPadding(e, t, d, b)
            insets
        }
        setContentView(raiz)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        CookieManager.getInstance().setAcceptCookie(true)
        web.addJavascriptInterface(Nativo(), "VTNativo")

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                if (req.url.host == HOST) return false
                if (req.url.host == Uri.parse(WEB_BASE).host) return false      // painel de admin (o do site), dentro da propria app
                // «Guardar o PDF»: fica na propria app (o DownloadListener guarda-o), em vez de abrir no navegador
                if (req.url.host == Uri.parse(SALAS_API).host && req.url.path?.startsWith("/pdf/") == true && req.url.getQueryParameter("dl") != null) return false
                startActivity(Intent(Intent.ACTION_VIEW, req.url))
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                paginaDoHost = Uri.parse(url).host == HOST
                // painel de admin: entra ja como dono, com a chave de sessao deste aparelho
                if (Uri.parse(url).host == Uri.parse(WEB_BASE).host && BuildConfig.VT_OWNER_TOKEN.isNotEmpty()) {
                    val tok = BuildConfig.VT_OWNER_TOKEN
                    view.evaluateJavascript("(function(){try{if(localStorage.getItem('vt.pin')!=='$tok'){localStorage.setItem('vt.pin','$tok');location.reload();}}catch(e){}})()", null)
                    return
                }
                onPage(url)
            }

            override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
                if (!req.isForMainFrame) return
                view.loadDataWithBaseURL(
                    "http://$HOST/", offlineHtml(err.description.toString()), "text/html", "utf-8", null
                )
            }
        }

        // PDF guardado: vai para a pasta Transferencias do aparelho, com notificacao do Android
        web.setDownloadListener { url, _, disposicao, mime, _ ->
            try {
                val nome = Regex("filename=\"?([^\";]+)\"?").find(disposicao ?: "")?.groupValues?.get(1) ?: "proposta.pdf"
                val pedido = android.app.DownloadManager.Request(Uri.parse(url))
                    .setMimeType(mime ?: "application/pdf")
                    .setTitle(nome)
                    .setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(android.os.Environment.DIRECTORY_DOWNLOADS, nome)
                (getSystemService(DOWNLOAD_SERVICE) as android.app.DownloadManager).enqueue(pedido)
                Toast.makeText(this, "PDF guardado em Transferências: $nome", Toast.LENGTH_LONG).show()
            } catch (e: Exception) {
                Toast.makeText(this, "Não consegui guardar o PDF.", Toast.LENGTH_LONG).show()
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
                val cfg = JSONObject().put("search", BuildConfig.VT_SEARCH).put("salasApi", SALAS_API).put("webBase", WEB_BASE).put("donoToken", BuildConfig.VT_OWNER_TOKEN)
                web.evaluateJavascript(salasJs, null)
                web.evaluateJavascript("($appJs)($cfg)", null)
            }
        }
    }

    /**
     * Contactos do telemovel para o chat do evento — como o WhatsApp: a permissao e pedida ao Android ao tocar em «Sincronizar» e a partir
     * dai a sincronizacao e automatica. Nada sai do telemovel: o ecra do chat guarda o que recebe so neste aparelho.
     * Para nao entregar a agenda inteira, a pagina diz que nomes procura (3 letras de cada nome da equipa) e so voltam os contactos parecidos.
     */
    inner class Nativo {
        /**
         * Botao 🔔 da escala: abre o ecra do Android com o interruptor «Todas as notificacoes» do Chrome (ou do navegador por omissao).
         * Uma pagina web nao consegue chegar aqui (o Chrome bloqueia atalhos para as Definicoes), por isso e esta app que o faz.
         */
        @JavascriptInterface
        fun abrirNotificacoes(): Boolean {
            if (!paginaDoHost) return false
            val pm = packageManager
            val candidatos = mutableListOf("com.android.chrome")
            try {
                val nav = pm.resolveActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://things-on.mike-app.com/")), PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName
                if (nav != null && nav != "android") candidatos.add(0, nav)
            } catch (e: Exception) { }
            val pacote = candidatos.firstOrNull { p -> try { pm.getPackageInfo(p, 0); true } catch (e: Exception) { false } } ?: return false
            runOnUiThread {
                try {
                    startActivity(Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, pacote).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                } catch (e: Exception) {
                    try { startActivity(Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pacote")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (e2: Exception) { }
                }
            }
            return true
        }

        /** Botao «Admin» da escala: abre o painel de pedidos do site, na propria app (so a partir da pagina do 7Eventos). */
        @JavascriptInterface
        fun abrirAdmin() {
            if (!paginaDoHost || BuildConfig.VT_OWNER_TOKEN.isEmpty()) return
            runOnUiThread { web.loadUrl(WEB_BASE + "?admin=pedidos") }
        }

        @JavascriptInterface
        fun temPermissao(): Boolean = checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED

        @JavascriptInterface
        fun pedirPermissao() {
            runOnUiThread { requestPermissions(arrayOf(Manifest.permission.READ_CONTACTS), PEDIDO_CONTACTOS) }
        }

        @JavascriptInterface
        fun lerContactos(consultasJson: String): String {
            if (!paginaDoHost || !temPermissao()) return "[]"
            val consultas = HashSet<String>()
            try {
                val a = JSONArray(consultasJson)
                for (i in 0 until a.length()) normalizar(a.optString(i)).takeIf { it.length >= 3 }?.let { consultas.add(it) }
            } catch (e: Exception) { return "[]" }
            if (consultas.isEmpty()) return "[]"

            return consultar(MAX_CONTACTOS) { nome -> parecido(nome, consultas) }
        }

        /** Procura por texto (o ecra do chat usa-a quando o contacto nao casou sozinho): contactos cujo nome contem o que a pessoa escreveu. */
        @JavascriptInterface
        fun procurar(texto: String): String {
            if (!paginaDoHost || !temPermissao()) return "[]"
            val q = normalizar(texto)
            if (q.length < 2) return "[]"
            return consultar(MAX_BUSCA) { nome -> normalizar(nome).contains(q) }
        }

        private fun consultar(max: Int, quer: (String) -> Boolean): String {
            val nomes = HashMap<Long, String>()
            val telefones = HashMap<Long, MutableList<String>>()
            val emails = HashMap<Long, String>()
            try {
                contentResolver.query(
                    ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                    arrayOf(ContactsContract.CommonDataKinds.Phone.CONTACT_ID, ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER),
                    null, null, null
                )?.use { c ->
                    while (c.moveToNext()) {
                        val id = c.getLong(0)
                        val nome = c.getString(1) ?: continue
                        val num = c.getString(2) ?: continue
                        if (!quer(nome)) continue
                        nomes[id] = nome
                        telefones.getOrPut(id) { mutableListOf() }.let { if (num !in it) it.add(num) }
                    }
                }
                if (nomes.isNotEmpty()) {
                    contentResolver.query(
                        ContactsContract.CommonDataKinds.Email.CONTENT_URI,
                        arrayOf(ContactsContract.CommonDataKinds.Email.CONTACT_ID, ContactsContract.CommonDataKinds.Email.ADDRESS),
                        null, null, null
                    )?.use { c ->
                        while (c.moveToNext()) {
                            val id = c.getLong(0)
                            if (id in nomes && id !in emails) emails[id] = c.getString(1) ?: ""
                        }
                    }
                }
            } catch (e: Exception) { return "[]" }

            val out = JSONArray()
            for ((id, nome) in nomes) {
                if (out.length() >= max) break
                out.put(JSONObject().put("n", nome).put("t", JSONArray(telefones[id] ?: emptyList<String>())).put("e", emails[id] ?: ""))
            }
            return out.toString()
        }
    }

    private fun normalizar(s: String): String =
        Normalizer.normalize(s.lowercase(), Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "").replace(Regex("[^a-z0-9 ]"), " ").replace(Regex("\\s+"), " ").trim()

    private fun parecido(nome: String, consultas: Set<String>): Boolean =
        normalizar(nome).split(" ").any { palavra -> consultas.any { palavra.startsWith(it) } }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PEDIDO_CONTACTOS) {
            val ok = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
            web.evaluateJavascript("(function(){if(window.__vtPerm)window.__vtPerm($ok)})()", null)
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
        // «Voltar» no painel de admin (o do site) volta a escala
        if (Uri.parse(web.url ?: "").host == Uri.parse(WEB_BASE).host) { web.loadUrl(START); return }
        // fecha o painel de detalhe se estiver aberto, senao sai
        web.evaluateJavascript(
            "(function(){var c=document.getElementById('vtch');if(c){var x=c.querySelector('[data-acao=sair]');if(x){x.click();return 1}}var s=document.getElementById('sheet');if(s&&s.classList.contains('open')){s.classList.remove('open');return 1}return 0})()"
        ) { r -> if (r != "1") runOnUiThread { @Suppress("DEPRECATION") super.onBackPressed() } }
    }
}
