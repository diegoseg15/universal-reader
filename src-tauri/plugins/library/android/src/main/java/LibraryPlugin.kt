package com.universalreader.library

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

@TauriPlugin
class LibraryPlugin(private val activity: Activity) : Plugin(activity) {
    private val executor = Executors.newSingleThreadExecutor()
    private val preferences get() = activity.getSharedPreferences("reader-library", Context.MODE_PRIVATE)
    private val formats = setOf("pdf", "epub", "cbz", "cbr", "cb7", "cbt", "mobi", "azw", "azw3", "fb2", "djvu", "txt")

    private fun savedFolders(): List<Map<String, String>> {
        val data = JSONArray(preferences.getString("folders", "[]") ?: "[]")
        return (0 until data.length()).map {
            val folder = data.getJSONObject(it)
            mapOf("id" to folder.getString("id"), "name" to folder.getString("name"))
        }
    }

    private fun saveFolders(folders: List<Map<String, String>>) {
        val data = JSONArray()
        folders.forEach { data.put(JSONObject(it)) }
        check(preferences.edit().putString("folders", data.toString()).commit()) { "No se pudo guardar la biblioteca." }
    }

    private fun background(invoke: Invoke, action: () -> Unit) {
        executor.execute {
            try { action() } catch (error: Exception) {
                invoke.reject(error.message ?: "No se pudo acceder a la carpeta.")
            }
        }
    }

    @Command
    fun folders(invoke: Invoke) = background(invoke) { invoke.resolveObject(savedFolders()) }

    @Command
    fun pickFolder(invoke: Invoke) {
        try {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
            }
            startActivityForResult(invoke, intent, "folderPicked")
        } catch (error: Exception) { invoke.reject(error.message) }
    }

    @ActivityCallback
    fun folderPicked(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode == Activity.RESULT_CANCELED) { invoke.resolve(); return }
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            invoke.reject("No se pudo seleccionar la carpeta."); return
        }
        background(invoke) {
            activity.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            val document = DocumentsContract.buildDocumentUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri))
            var name = DocumentsContract.getTreeDocumentId(uri).substringAfterLast('/').substringAfterLast(':')
            activity.contentResolver.query(document, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use {
                if (it.moveToFirst()) name = it.getString(0)
            }
            val folder = mapOf("id" to uri.toString(), "name" to name.ifEmpty { "Colección" })
            val folders = savedFolders().filter { it["id"] != folder["id"] } + folder
            saveFolders(folders)
            invoke.resolveObject(folder)
        }
    }

    @Command
    fun removeFolder(invoke: Invoke) = background(invoke) {
        val id = invoke.getArgs().getString("id")
        val folders = savedFolders()
        check(folders.any { it["id"] == id }) { "La carpeta no pertenece a la biblioteca." }
        saveFolders(folders.filter { it["id"] != id })
        // Existing grants may also be used by an overlapping library folder.
        invoke.resolve()
    }

    @Command
    fun scanFolder(invoke: Invoke) = background(invoke) {
        val id = invoke.getArgs().getString("id")
        check(savedFolders().any { it["id"] == id }) { "La carpeta no pertenece a la biblioteca." }
        val tree = Uri.parse(id)
        val root = DocumentsContract.getTreeDocumentId(tree)
        val books = mutableListOf<Map<String, Any>>()
        val warnings = mutableListOf<String>()
        val stack = java.util.ArrayDeque<Triple<String, String, Int>>()
        val visited = mutableSetOf<String>()
        var count = 0
        var limited = false
        stack.add(Triple(root, "", 0))
        while (stack.isNotEmpty() && !limited) {
            val (parent, prefix, depth) = stack.removeLast()
            if (!visited.add(parent)) continue
            try {
                val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parent)
                val projection = arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED)
                val cursor = activity.contentResolver.query(children, projection, null, null, null)
                    ?: error("La carpeta no está disponible.")
                cursor.use {
                    while (it.moveToNext()) {
                        count++
                        if (count > 100000 || books.size >= 25000) { limited = true; break }
                        val documentId = it.getString(0)
                        val name = it.getString(1) ?: "Sin nombre"
                        val relativePath = prefix + name
                        if (it.getString(2) == DocumentsContract.Document.MIME_TYPE_DIR) {
                            if (depth < 64) stack.add(Triple(documentId, "$relativePath/", depth + 1))
                            else warnings.add("Se omitió una carpeta con demasiados niveles de profundidad.")
                        } else {
                            val format = name.substringAfterLast('.', "").lowercase(java.util.Locale.ROOT)
                            if (format in formats) books.add(mapOf(
                                "path" to DocumentsContract.buildDocumentUriUsingTree(tree, documentId).toString(),
                                "name" to name, "relativePath" to relativePath, "format" to format,
                                "size" to (if (it.isNull(3)) 0L else it.getLong(3).coerceAtLeast(0L)),
                                "modified" to (if (it.isNull(4)) 0L else it.getLong(4).coerceAtLeast(0L))
                            ))
                        }
                    }
                }
            } catch (error: Exception) {
                if (parent == root) throw error
                warnings.add("No se pudo leer $prefix")
            }
        }
        if (limited) warnings.add("Se alcanzó el límite de exploración. Añade subcarpetas por separado para ver más archivos.")
        invoke.resolveObject(mapOf("books" to books, "warnings" to warnings))
    }
}
