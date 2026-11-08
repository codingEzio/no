# no

<p><img src="extension_chrome/icons/icon-128.png" width="96" height="96" alt="no"></p>

[English](README.md) · [简体中文](README.zh-Hans.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md)

## Resumen

Bloquea los dominios elegidos con un NO ✋ de ventana completa. El código Chrome0.99.1 conserva la identidad y los ajustes existentes.

## Uso

En “Cargar descomprimida” de Chrome, seleccione extension_chrome/. Añada dominios o URL HTTP(S) en el popup, active las entradas y guarde. Debe permitir el acceso a sitios. La interfaz distingue las reglas guardadas y aplicadas de las pendientes; guardar otra vez reintenta. No cambie la clave pública ni borre ajustes para actualizar.

## Límites de plataforma

Chrome es el destino actual. El código Safari de escritorio conserva 0.99.0 y el CSS del popup usa la alternativa sans serif del sistema. El código completo del propietario conserva el script y los metadatos de tipografía anteriores; este cambio no migra las preferencias guardadas ni demuestra una sincronización completa de Safari. El código seleccionado omite iconos necesarios para generar el host nativo de forma independiente. Permisos, redirecciones reales, alternativa Service Worker y rendimiento requieren otra aceptación. Firefox está pausado. Compilar Chrome no acredita otros navegadores.

## Código y compilación

En macOS, instale Deno 2.x y Git y ejecute estos comandos en el repositorio. Las pruebas usan ejemplos locales sintéticos. La compilación crea un candidato en Local/candidates, ignorado por Git, y verifica sus bytes exactos. No instala la extensión, abre el navegador ni accede a ajustes personales. Las comprobaciones normales usan dependencias locales fijadas, sin repositorios hermanos.

```sh
deno task check
deno task build
```

## Privacidad y revisión

Prepare los archivos revisados por nombre y ejecute deno task public:check y deno task public:prepare. public-source.json selecciona entradas exactas del índice Git; excluye registros privados, configuración e historial Git. El candidato es inmutable: al repetir se compara y se rechazan diferencias sin sobrescribir. El escaneo limitado no verifica todo el historial ni detecta todos los secretos. La preparación no cambia destinos, datos ni ajustes del navegador.

## Licencia

El código propio de esta versión usa GNU GPL versión3 solamente, GPL-3.0-only. Las concesiones MIT de versiones anteriores siguen vigentes. Las fuentes y recursos ajenos conservan sus términos. Mantenga LICENSE, la concesión MIT anterior y todos los avisos. La revisión de derechos y contenido sigue siendo necesaria antes de publicar. Un candidato local no acredita publicación, instalación ni limpieza del historial completo.

## Valores privados opcionales

Al cargar `extension_chrome/`, cree el archivo ignorado `extension_chrome/private-defaults.json`, por ejemplo `{"domains":["example.com"]}`, y recargue la extensión. Es solo datos: se excluye de exportaciones y paquetes. Los ajustes guardados tienen prioridad; si faltan, se conservan y priorizan las reglas dinámicas existentes. Sin ambos, un archivo ausente o ilegible da una lista vacía; JSON inválido informa un error. Safari y Firefox no usan estos valores.
