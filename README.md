# TCG Manager

[![GitHub license](https://img.shields.io/github/license/Danikileitor/TCG-Manager.png)](https://github.com/Danikileitor/TCG-Manager/blob/main/LICENSE)

Gestor de colección de cartas TCG y constructor de mazos. TCG incluidos: **Magic: The Gathering**, **Yu-Gi-Oh!** y **Digimon Card Game**.

- Frontend: HTML + CSS + JS (módulos ES), sin frameworks.
- Backend: Netlify Functions (Node.js) → MongoDB Atlas.
- Las credenciales de la base de datos **solo existen en el servidor** (variables de entorno de Netlify). El navegador nunca habla con MongoDB.

## Estructura

```
tcg-manager/
├── netlify.toml                 # publicación, funciones y rutas /api/*
├── package.json                 # dependencias de las funciones
├── .env.example                 # plantilla de variables (copiar a .env en local)
├── .gitignore                   # excluye .env y node_modules
├── public/                      # web estática
│   ├── index.html               # login / registro
│   ├── home.html                # selección de TCG
│   ├── collection.html          # colección del usuario
│   ├── deck-builder.html        # constructor de mazos
│   ├── privacy.html             # política de privacidad
│   ├── terms.html               # condiciones del servicio
│   ├── css/  base.css · login.css · home.css · app.css · legal.css
│   ├── js/   api.js · ui.js · card-images.js · card-viewer.js · session.js · auth.js · home.js
│   │         collection.js · deck-builder.js · card-providers.js · catalog-search.js
│   │         games-cache.js · language.js
│   ├── data/banlists.json       # copia de seguridad de las listas de prohibidas/limitadas
│   ├── data/ygo/                # datos de Yu-Gi-Oh! (nombres por idioma, filtros, sets, artes alt.), generados
│   ├── site.webmanifest         # manifest de la web app (instalable)
│   └── favicon.ico · favicon-96x96.png · apple-touch-icon.png
│       web-app-manifest-192x192.png · web-app-manifest-512x512.png
├── scripts/
│   └── build-ygo-index.mjs      # genera public/data/ygo a partir de YGOJSON
└── netlify/functions/           # backend serverless
    ├── _lib/ db.js · auth.js · http.js · games.js
    ├── auth-register.js · auth-login.js · auth-logout.js · auth-me.js
    ├── auth-google.js · auth-config.js
    ├── games.js · collection.js · decks.js
    ├── digimon-search.js        # plan B de la búsqueda de Digimon (llama a la API desde el servidor)
```

## 1. Preparar MongoDB Atlas

1. Crea un cluster (el gratuito M0 sirve).
2. **Database Access** → crea un usuario **exclusivo para esta app** con rol `readWrite` solo sobre la base `tcgmanager` (no uses el usuario admin).
3. **Network Access** → Netlify Functions no tiene IP fija en el plan gratuito, así que hay que permitir `0.0.0.0/0`. Compénsalo con una contraseña larga y aleatoria.
4. **Connect → Drivers** → copia la cadena `mongodb+srv://...` y sustituye usuario y contraseña.

Las colecciones (`users`, `usercards`, `decks`, `games`) y sus índices se crean solos en la primera petición; no hay que hacer nada a mano.

## 2. Probar en local

```bash
npm install
cp .env.example .env      # y rellena MONGODB_URI y JWT_SECRET
npx netlify-cli dev       # http://localhost:8888
```

Para generar un `JWT_SECRET` aleatorio:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## 3. Desplegar (GitHub → Netlify)

1. Sube el proyecto a GitHub (el `.gitignore` ya excluye `.env`; comprueba que no se sube).
2. En Netlify: **Add new site → Import from Git** y elige el repositorio. `netlify.toml` ya indica la carpeta pública y la de funciones.
3. **Site configuration → Environment variables** y añade estas variables. Marca como _secret_ solo `MONGODB_URI` y `JWT_SECRET`:
   - `MONGODB_URI` (_secret_)
   - `JWT_SECRET` (_secret_)
   - `GOOGLE_CLIENT_ID` (opcional, ver sección 4; **sin** marcar como secret)
   - `MONGODB_DB` (opcional, por defecto `tcgmanager`; **sin** marcar como secret).
4. Haz un nuevo deploy para que las funciones lean las variables.

## 4. Iniciar sesión con Google (opcional)

El botón "Continuar con Google" solo aparece si existe la variable `GOOGLE_CLIENT_ID`. Sin ella, el login con usuario y contraseña funciona igual.

1. En [Google Cloud Console](https://console.cloud.google.com/) crea (o elige) un proyecto.
2. Configura la **pantalla de consentimiento de OAuth** (Google Auth Platform): tipo _Externo_, nombre de la app y tu email. Para que pueda entrar cualquier persona, publica la app en producción (mientras esté en "Pruebas" solo entran los usuarios de prueba que añadas). Con los permisos básicos (email y perfil) no se requiere verificación de Google.
3. Crea un **ID de cliente OAuth** de tipo **Aplicación web** (sección Credenciales / Clientes).
4. En **Orígenes de JavaScript autorizados** añade, sin barra final:
   - `https://TU-SITIO.netlify.app` (y tu dominio propio si lo usas)
   - `http://localhost:8888` (para `netlify-cli dev`)

   No hace falta rellenar "URI de redireccionamiento": este flujo usa un botón con ventana emergente.

5. Copia el **ID de cliente** (termina en `.apps.googleusercontent.com`). No necesitas el "client secret".
6. En Netlify añade la variable `GOOGLE_CLIENT_ID` con ese valor. **No la marques como secret** (es público y se envía al navegador) y lanza un nuevo deploy.

Cómo funciona: el navegador recibe de Google un token firmado y lo envía a `/api/auth/google`; el servidor lo verifica (firma, caducidad, emisor y audiencia) y exige que el email esté verificado por Google. Después crea la cuenta o inicia sesión y emite la misma cookie de sesión que el login normal.

Reglas de cuentas:

- Primera vez con Google: la web te pide **elegir un nombre de usuario** (con una sugerencia a partir de tu nombre) antes de crear la cuenta, que queda sin contraseña. Hasta que lo eliges no se guarda nada en la base de datos. El nombre es único **sin distinguir mayúsculas** ("Ana" y "ana" cuentan como el mismo).
- Si ya existe una cuenta **con contraseña** que usa el mismo email, no se vincula automáticamente (el registro con contraseña no verifica el email y vincular permitiría el robo de cuentas); se pide iniciar sesión con la contraseña. Una futura pantalla de ajustes podría ofrecer vincular Google desde una sesión ya iniciada.
- Las cuentas creadas con Google no pueden entrar con contraseña.

## 5. Páginas legales

`public/privacy.html` (política de privacidad) y `public/terms.html` (condiciones del servicio) están enlazadas desde el login y desde el pie de la home. Google exige que la página de inicio enlace a la política de privacidad para la verificación de marca.

**Antes de publicar**, sustituye en ambas páginas los datos marcados en amarillo:

- `[TU NOMBRE O RAZÓN SOCIAL]`
- `[TU EMAIL DE CONTACTO]`

Y revisa que el texto refleja lo que realmente haces con los datos (si añades analítica, otros proveedores o una función de borrado de cuenta, actualízalas y cambia la fecha). Son textos de partida, no asesoramiento jurídico.

## 6. URLs sin `.html`

Las páginas se enlazan sin extensión (`/home`, `/collection?game=mtg`, `/deck-builder?game=mtg`, `/terms`, `/privacy`) y `netlify.toml` redirige (301) las versiones con `.html` a la limpia. **No añadas reglas inversas** (`/terms` → `/terms.html`): provocarían un bucle de redirecciones. Al crear una página nueva, enlázala sin extensión y añade su regla `.html` → limpia en `netlify.toml`.

## 7. Rendimiento

- **Lista de TCG en la home:** `public/js/games-cache.js` la guarda en `localStorage` (10 min). Con caché aparece al instante y sin peticiones; si está caducada, se muestra la guardada y se refresca en segundo plano. La sesión y los TCG se piden en paralelo.
- **Servidor:** `/api/games` cachea la lista 5 min en memoria de la función y responde con `Cache-Control: private, max-age=300, stale-while-revalidate=86400`. Si añades un TCG nuevo, puede tardar hasta ~10 min en aparecer a quien ya tenga la caché.
- **Iconos:** se sirven con caché de 1 día.
- La primera petición tras un rato sin tráfico puede ser más lenta (arranque en frío de la función de Netlify y conexión a Atlas); no se puede evitar en el plan gratuito.

Optimizaciones recientes: el simulador de mano y el diálogo de importar/exportar (~70 KB de JS) se cargan solo al pulsar su botón; `/js/*` y `/css/*` se cachean 5 min con revalidación en segundo plano; la vista previa al pasar el ratón se recoloca como mucho una vez por fotograma.

## 8. Idiomas de las cartas

En la colección y en el constructor de mazos hay un selector de **idioma de las cartas** que usa los **nombres oficiales** de cada catálogo (nada se traduce). Cada carta guarda el idioma con el que se añadió, y la colección se puede filtrar por idioma. Una carta en español y la misma en inglés son entradas distintas, porque son copias físicas distintas.

| TCG | Idiomas | Notas |
| --- | ------- | ----- |
| MTG (Scryfall) | es, en, fr, de, it, pt, ja, ko, ru, zhs, zht | Nombre, tipo e imagen de la impresión en ese idioma. Solo aparecen las cartas impresas en él. |
| Yu-Gi-Oh! (YGOJSON) | es, en, fr, de, it, pt, ja, ko, zhs, zht | Solo aparecen las cartas con nombre oficial en ese idioma (en chino tradicional hay muy pocas). Las imágenes son las de la versión en inglés. |
| Digimon (digimoncard.io) | en | La fuente solo devuelve nombres en inglés. |

Los idiomas de cada TCG se declaran en `public/js/card-providers.js` (`languages` de cada proveedor): para añadir idiomas basta con cambiar de fuente o ampliar esa lista. La lista de códigos válidos del servidor está en `netlify/functions/_lib/games.js` (`VALID_LANGUAGES`).

### Búsqueda avanzada y artes alternativos

El buscador de cartas (`public/js/catalog-search.js`, usado en la colección y en el constructor de mazos) tiene un botón **Filtros** que abre un panel lateral, las etiquetas de los filtros activos (se quitan una a una) y la casilla **Incluir artes alternativos** (desactivada por defecto). Se puede buscar solo con filtros, sin escribir un nombre, y los resultados se cargan por páginas ("Cargar más resultados").

Los filtros numéricos (coste, nivel, ATK…) piden un valor fijo; marcando la casilla **Rango** junto al filtro se cambian por un mínimo y un máximo.

En Magic, el campo **Subtipo o supertipo** sugiere los tipos en el idioma de las cartas elegido (y se puede escribir lo que se quiera). Scryfall no publica traducciones de los tipos, así que se aprenden de las propias cartas: cada una trae su línea de tipo en inglés y la impresa en su idioma, y se emparejan solo cuando es seguro. La primera vez que se usa un idioma se descargan 8 páginas de cartas de Scryfall (unos segundos, en segundo plano) y el resultado se guarda una semana en el navegador (`localStorage`, clave `tcg.mtgtypes.v1.<idioma>`). En inglés se usan los catálogos oficiales de Scryfall. Al buscar, cada tipo conocido se envía en inglés y en el idioma elegido.

Cada TCG declara sus filtros en `public/js/card-providers.js` (`filters` de cada proveedor); el panel se dibuja solo a partir de esa lista:

| TCG | Filtros |
| --- | ------- |
| Magic | Tipo, subtipo, texto de reglas, colores (con modo incluye/exacto/solo), identidad de color, coste de maná, fuerza, resistencia, edición, rareza, formato |
| Yu-Gi-Oh! | Tipo de carta, subtipo de Magia/Trampa, atributo, tipo de monstruo, categoría (Efecto, Sincronía, Xyz…), nivel/rango/enlace, ATK, DEF, escala de Péndulo, set |
| Digimon | Tipo, color, texto del efecto, nivel, etapa, atributo, tipo digital, coste de juego, coste y color de evolución, DP, pack, número de carta, rareza, ilustrador |

Artes alternativos: en Magic se usa `unique=art` de Scryfall (una carta por ilustración); en Yu-Gi-Oh! salen las imágenes extra de cada carta en YGOJSON, con su propio `cardId`; en Digimon se añaden desde `public/data/digimon/arts.json` (ver abajo). Las cartas con otra ilustración llevan la etiqueta "Arte alt.".

**Digimon:** la [API de digimoncard.io](https://digimoncard.io/api-documentation) admite llamadas desde cualquier dominio, pero limita a 15 peticiones cada 10 segundos por IP, por eso el navegador de cada usuario la llama directamente (con una caché de 5 minutos en memoria). Si el navegador no puede (bloqueador, red, etc.), usa como plan B la función `netlify/functions/digimon-search.js`. La API no tiene filtro de rareza y **no devuelve los artes alternativos** (de BT17-077 solo da la carta normal): la rareza se aplica en local sobre la respuesta, y los artes alternativos se añaden desde un archivo propio. La rareza necesita ir con otro criterio (nombre, color…). Sin resultados, la API responde HTTP 400 y la web lo muestra como "Sin resultados".

En el constructor de mazos, los filtros solo están en la pestaña **Catálogo**; "Mi colección" sigue buscando por nombre.

### Vista ampliada de las cartas

- **Tooltip:** al pasar el ratón sobre una carta (colección, resultados del catálogo y mazo) aparece en grande para leer el texto. Solo en dispositivos con ratón.
- **Vista 3D:** al hacer clic se abre un popup con el fondo oscurecido y la carta en un `<canvas>` WebGL. Arrastra para girarla en horizontal, rueda o pellizco para zoom, Mayús + arrastrar para moverla, botón o tecla `F` para darle la vuelta, `0` o doble clic para restablecer, `Esc` para cerrar.
- **Dorso:** las cartas de dos caras de MTG guardan `imageBack` (colección y mazos). Las demás muestran el dorso de su juego: se busca `public/img/backs/<juego>.webp|jpg|png` (`ygo`, `digimon`, `digimon-egg` para los Digi-Egg, que tienen otro dorso, y `mtg`; ver `LEEME.txt` en esa carpeta) y, para MTG, el dorso oficial de Scryfall como respaldo. **Debes añadir tú las imágenes de Yu-Gi-Oh! y Digimon (normal y Digi-Egg)** (no se incluyen por ser material con derechos de autor). Si no hay imagen, se dibuja un dorso genérico. Las cartas de dos caras guardadas antes de esta versión no lo tienen hasta que se vuelvan a añadir.
- **Resolución:** en la vista 3D se pide la mejor imagen disponible (MTG: PNG de 745×1040 px; Yu-Gi-Oh!: tamaño completo de YGOPRODeck). Las imágenes menores de 1000 px de alto se escalan 1,5–2× con suavizado y un filtro de nitidez ligero para que el texto se lea mejor (no añade detalle que la imagen no tenga). Digimon no ofrece una versión mayor.
- **CORS:** WebGL solo puede usar imágenes de servidores que lo permitan (Scryfall y YGOPRODeck lo hacen). Si no, o si el navegador no tiene WebGL, se usa automáticamente una vista equivalente con CSS 3D.

**Artes alternativos de Digimon:** `scripts/build-digimon-arts.mjs` genera `public/data/digimon/arts.json` (≈80 KB, 4.400 artes de ≈2.700 cartas) a partir de los datos de artes del proyecto [Aegis](https://github.com/vinicius3333/aegis-digimon-tcg) (licencia MIT), que a su vez los toma de [Digimon-Card-App](https://github.com/TakaOtaku/Digimon-Card-App). Con la casilla activada, tras cada carta se añaden sus `<carta>_P1`, `_P2`… con el pack o evento de cada una. Las imágenes se piden al servidor de la comunidad `web-garage.takaotaku.de/<carta>_P<n>.webp` y, si falla, a la lista oficial de Bandai. **Las cartas normales de Digimon usan ahora ese mismo servidor** (`web-garage.takaotaku.de/<carta>.webp`, mayor resolución que digimoncard.io), con respaldo en `images.digimoncard.io/images/cards/<carta>.webp` y luego en Bandai; las cartas ya guardadas con la imagen antigua se cambian al mostrarlas. Para actualizar los datos cuando salgan sets nuevos: `node scripts/build-digimon-arts.mjs`.

### Filtros de "Mi colección"

En la colección hay un cuadro de búsqueda por nombre (sin distinguir tildes), un selector de orden (nombre, añadidas recientemente, copias, coste/nivel, edición) y un botón **Filtros** con un panel lateral como el del catálogo. Todo se filtra en el navegador. Las opciones salen de lo que tienes: solo se ofrecen los colores, tipos, ediciones, rarezas, estados, acabados e idiomas que existan en tu colección.

- **Datos de la carta:** color (con "cualquiera / todos / solo esos"), tipo (se deben tener todos los elegidos), atributo, subtipo/raza/rasgo (con sugerencias; en MTG se sugieren y se buscan en el idioma elegido en "Idioma de las cartas", con el mismo diccionario aprendido del buscador, y también se acepta el inglés), y valores numéricos (fijo o rango): coste de maná y fuerza en MTG, nivel/rango/enlace y ATK en Yu-Gi-Oh!, coste de jugada, nivel y DP en Digimon.
- **En mi colección:** idioma, edición, rareza, estado, acabado y número de copias.
- **Cómo se guardan:** cada carta lleva un objeto `facets` (`colors`, `types`, `subtypes`, `attribute`, `cost`, `level`, `power`) que `netlify/functions/collection.js` valida y guarda. MTG y Digimon lo reciben al añadir la carta desde el catálogo; Yu-Gi-Oh! lo calcula con los archivos locales. Las cartas guardadas antes de esta versión se completan solas la primera vez que abres la colección (MTG: una petición a Scryfall por cada 75 cartas; Yu-Gi-Oh!: en local; Digimon: una consulta por carta, con pausas por el límite de la API) y se guardan con `PUT /api/collection` `{ items: [{ id, facets }] }`. Mientras tanto, esas cartas no aparecen al filtrar por datos de la carta.
- El listado de la colección carga hasta 5.000 cartas por juego.

### Mazos como tarjetas y carta insignia

Si no hay ningún mazo abierto, *Mazos* muestra tus mazos como tarjetas (igual que la colección), con su nombre, formato y número de cartas. Clic en una tarjeta para abrirla; el desplegable sigue funcionando. La imagen de cada mazo es su **carta insignia**: en el editor, pulsa la estrella ☆ de una carta para marcarla (★); si no eliges ninguna, se usa la primera carta del mazo. Se guarda en el campo `cover` del mazo.

### Límite de copias por carta

El editor de mazos no deja pasar del límite de copias (el botón "+ Mazo" avisa y el "+" de la fila se desactiva). Se cuenta por carta entre todas las zonas (Main, Extra, Side, Comandante…) y no depende de la edición ni del idioma:

| TCG / formato | Límite |
|---|---|
| MTG (Standard, Modern, Pioneer, Legacy, Vintage, Pauper) | 4 por nombre |
| MTG Commander | 1 por nombre |
| MTG, excepciones | sin límite: tierras básicas y cartas como Relentless Rats; Seven Dwarves 7, Nazgûl 9 |
| Yu-Gi-Oh! (todos los formatos) | 3 por carta |
| Digimon | 4 por número de carta (los artes alternativos cuentan como la misma carta) |

Al importar un mazo se recortan las copias que pasen del límite del formato (se avisa de cuántas). Si cambias a un formato más estricto, las copias de más no se borran: se muestra un aviso. Las listas de prohibidas/limitadas se suman a este límite (siguiente apartado). Reglas en `public/js/deck-rules.js`.

### Estadísticas, probabilidades y "qué me falta"

El botón **Estadísticas** del editor de mazos abre un diálogo con tres pestañas:

- **Estadísticas**: curva de coste (MTG, sin tierras; Digimon por coste de juego; Yu-Gi-Oh! por nivel de los monstruos), reparto de colores o atributos y de tipos. Las cartas guardadas antes de existir esto se completan una vez (Scryfall, archivos locales de YGO o la API de Digimon) y desde ahí se guardan con el mazo (`facets`).
- **Probabilidades**: calculadora hipergeométrica. Eliges una carta y cuántas copias quieres ver y muestra la probabilidad por turno (1 a 8), con mano inicial de 7 (MTG) o 5 (Yu-Gi-Oh!, Digimon), yendo primero o segundo.
- **Qué me falta**: compara el mazo con tu colección (por nombre en MTG/YGO y por número de carta en Digimon, sin importar edición) y da la lista de compra, que se puede copiar o descargar en `.txt`.

Código en `public/js/deck-stats.js` (se carga solo al abrir el diálogo).

### Prohibidas, limitadas y formato Digimon C / U

En el buscador del editor de mazos, cada carta afectada por la lista del formato elegido muestra en la esquina superior derecha de su imagen un símbolo rojo de prohibido (🚫) o un número amarillo dentro de un círculo rojo (1, 2 o 3 copias). Al cambiar de formato las insignias se actualizan. La misma marca aparece en cada carta del mazo, justo a la izquierda del selector de copias. Además, el editor **no deja añadir** cartas prohibidas ni pasar del límite (mensaje al pulsar "+ Mazo"), y avisa si un mazo importado o cambiado de formato incluye cartas ilegales.

| TCG | Fuente (siempre actual) | Formatos con lista |
|---|---|---|
| MTG | `legalities` que Scryfall devuelve con cada carta (banned = prohibida, restricted = 1 copia). Para cartas de la colección o de mazos guardados se consulta `cards/collection` de Scryfall | Standard, Modern, Pioneer, Commander, Legacy, Vintage, Pauper |
| Yu-Gi-Oh! | API de YGOPRODeck (`banlist=tcg`): Banned / Limited / Semi-Limited | Advanced. **Traditional y Speed Duel no tienen fuente automática fiable: no se marca nada** |
| Digimon | Página oficial de cartas restringidas de Bandai (`world.digimoncard.com/rule/restriction_card`): prohibidas, restringidas a 1 y parejas prohibidas (estas últimas salen como aviso en el mazo) | Standard y C / U |

**Actualización automática.** La función `netlify/functions/banlists.js` (`/api/banlists`) lee esas fuentes y responde con caché de 12 h en el CDN de Netlify; el navegador la guarda otras 24 h. No hay que tocar nada cuando salga una lista nueva: se recoge sola en el siguiente día. Si una fuente falla o la página oficial cambia de estructura (se comprueba que la lista tenga un tamaño razonable), se usa la copia de seguridad `public/data/banlists.json` (Digimon con la lista de 1-sep-2026; las parejas prohibidas de Digimon se mantienen siempre en ese archivo, edítalo si cambian). Si ni eso funciona, el editor sigue funcionando sin insignias.

**Digimon C / U** (`c-u`): solo cartas Common (C) y Uncommon (U), incluidos Digi-Egg, Tamer y Option; no se admiten R, SR, SEC ni P. Los artes alternativos de cartas C/U sí valen. Se basa en el evento oficial *Regulation Battle Vol. 1 (C & U Limited Battles)* de Bandai; no existe un reglamento permanente, así que se asumen 4 copias por número de carta y **también se aplica la lista de prohibidas/restringidas del formato Standard** (suposición, puedes quitarla en `statusFor` de `public/js/banlist.js`). La rareza se comprueba con la que devuelve el catálogo, por lo que las cartas de "Mi colección" (que no guardan rareza) no se marcan por rareza.

### Nombres con set, Ace y Dual

En el editor de mazos cada carta muestra su set: `Yuriko, la Sombra del Tigre CMM` (MTG) y `Examon Ace BT20`, `BeelStarmon Dual BT25` (Digimon; el set sale del número de la carta). Las variantes se detectan así: **Ace** si el nombre lo dice o la carta tiene *Overflow* en sus efectos; **Dual** si el nombre es "A // B" o dice Dual. Se guardan con la carta (`variant`); las cartas antiguas se completan en segundo plano (una consulta a la API por carta, recordada en el navegador) y las de MTG sin set se completan con Scryfall.

### Formatos y zonas de los mazos

El formato "casual" ya no existe (los mazos que lo tenían pasan al primer formato de su juego) y la zona **Comandante** solo aparece en el formato Commander; al cambiar a otro formato sus cartas pasan al mazo principal. La cabecera (marca) se pinta al instante y el usuario se completa cuando se confirma la sesión.

### Mano inicial

En *Mazos*, el botón **Mano inicial** abre un simulador 3D (WebGL, o CSS 3D si el servidor de imágenes no permite leerlas en WebGL) que baraja la zona principal del mazo y reparte una mano:

| TCG | Mano | Mulligan |
|---|---|---|
| MTG | 7 cartas | Mulligan de Londres, varias veces: robas 7 nuevas y eliges tantas cartas para el fondo del mazo como mulligans lleves |
| Yu-Gi-Oh! | 5 cartas | No hay (*Nueva mano* baraja y reparte otra vez para practicar) |
| Digimon | 5 cartas | Uno solo: la mano vuelve al mazo, se baraja y se roban 5 |

Clic en el mazo (arriba a la derecha) para robar. Las cartas que robas se añaden a la derecha y, si no caben, la mano se desplaza como un abanico (rueda, arrastrar o flechas ← →). Además: *Robar carta*, *Nueva mano*, clic en una carta para verla en el visor 3D y atajos N / M / D. Las reglas están en `public/js/hand-logic.js` (sin DOM, fácil de ajustar) y la escena en `public/js/hand-sim.js`. Usa el dorso del juego de `public/img/backs/` si existe. Si una imagen trae un marco blanco o transparente pegado al borde, se muestra solo la parte con la carta, estirada para rellenarla entera (la imagen original no se modifica). Para poder leer los píxeles cuando el servidor de imágenes no permite CORS se usa `netlify/functions/image-proxy.js` (solo usuarios con sesión y solo los servidores de imágenes de la lista blanca del archivo).

### Importar y exportar (colección y mazos)

El botón **Importar / Exportar** está en *Mi colección* y en *Mazos*. El formato se detecta solo al importar.

| | Colección | Mazos |
|---|---|---|
| **MTG** | CSV de Moxfield, ManaBox, Archidekt y Deckbox, lista de texto (`4 Nombre (SET) 123`), CSV y JSON propios | Texto (MTG Arena / MTGO / Moxfield, con `Commander`, `Deck`, `Sideboard` o `SB:`), CSV, JSON |
| **Yu-Gi-Oh!** | CSV, texto, JSON | `.ydk` (EDOPro, YGOPro…), enlace `ydke://`, texto, CSV, JSON |
| **Digimon** | CSV, texto (`4 Nombre BT1-010`), JSON | Texto, lista de números (una por copia), CSV, JSON |

- El **JSON de TCG Manager** es una copia completa (sin consultas al catálogo al importarlo).
- Al importar, las cartas se buscan en el catálogo (Scryfall por id, edición + número o nombre; Yu-Gi-Oh! por código o nombre en inglés; Digimon por número) y se muestra un resumen con las que no se encontraron, que se omiten.
- Colección: *Añadir* suma cantidades a lo que ya tienes; *Reemplazar* borra antes la colección de ese juego (pide confirmación). Mazos: la importación siempre crea un mazo nuevo.
- Al exportar se usan los nombres en inglés y, en MTG, la edición y el número de coleccionista (si faltan en cartas antiguas, se consultan a Scryfall).
- Código: `public/js/transfer.js` (formatos, sin red), `transfer-dialog.js` (diálogo), `resolveEntries` y `completeForExport` en `card-providers.js`, y `POST /api/collection?bulk=1` (lotes de hasta 500 cartas) en `netlify/functions/collection.js`.

### Yu-Gi-Oh!: índice de YGOJSON

[YGOJSON](https://github.com/iconmaster5326/YGOJSON) no es una API de búsqueda, sino miles de cartas en archivos JSON (el agregado pesa ~110 MB). Por eso el script `scripts/build-ygo-index.mjs` genera un índice mínimo por idioma en `public/data/ygo/` (id, nombre oficial, nombre en inglés, tipo e imagen). El navegador descarga solo el del idioma elegido, la primera vez que se busca (~1 MB sin comprimir, ~0,3 MB comprimido; Netlify lo comprime y `netlify.toml` lo cachea), y busca en local sin más peticiones. Los demás archivos solo se descargan si se usan: `details.json` (atributo, tipo, nivel, ATK/DEF…) al aplicar filtros, `sets.json` y `cardsets.json` al filtrar por set, y `arts.json` al activar los artes alternativos.

- **Los índices ya están generados** y van en el repositorio: no hace falta ejecutar nada para desplegar.
- **Para actualizarlos** (Node 18 o superior, sin dependencias): `node scripts/build-ygo-index.mjs` y sube los cambios de `public/data/ygo`. El script descarga unos 35 MB de GitHub.
- El `cardId` de cada carta es su passcode, el mismo que usaba YGOPRODeck, así que las cartas y mazos ya guardados siguen valiendo.
- Se excluyen fichas (tokens) y cartas Skill. YGOJSON no incluye Rush Duel.
- La fecha de los datos aparece en `public/data/ygo/meta.json` (`sourceLastYGOProDeckRead` y `sourceLastYugipediaRead`): son las últimas lecturas del propio YGOJSON, y las cartas posteriores a esa fecha no estarán hasta que YGOJSON se actualice.
- Las cartas ya no muestran código de set ni rareza, porque el índice no incluye los sets.

## Seguridad implementada

- Contraseñas con **bcrypt** (coste 12); nunca en texto plano.
- Sesión con **JWT en cookie `HttpOnly; Secure; SameSite=Strict`** (el JS del navegador no puede leerla).
- Mensaje de error genérico en el login (no revela si el usuario existe).
- Cada consulta filtra por el `userId` **del token**, nunca por uno enviado por el cliente.
- Validación y límites de tamaño en el servidor; las escrituras exigen `Content-Type: application/json`.
- El DOM se construye con `textContent` (sin `innerHTML` con datos de usuario) para evitar XSS.

Pendiente recomendado antes de producción: limitar intentos de login (rate limiting), por ejemplo con un contador por IP/usuario en MongoDB o con un servicio externo, ya que las funciones serverless no comparten memoria entre instancias.

## Catálogo de cartas

El catálogo **no se guarda** en tu base de datos; se consulta desde el navegador (`public/js/card-providers.js`):

| TCG       | Fuente                                          |
| --------- | ----------------------------------------------- |
| MTG       | API de Scryfall                                 |
| Yu-Gi-Oh! | Índice propio generado desde YGOJSON (ver arriba) |
| Digimon   | API de digimoncard.io, llamada desde el navegador (plan B: función `digimon-search`) |

Tú solo guardas lo que posee cada usuario (`usercards`) y sus mazos (`decks`), referenciando cada carta por su `cardId`. Si una API cambia sus campos o sus condiciones de acceso, solo hay que tocar `card-providers.js`. Si más adelante quieres cachear el catálogo en Atlas, bastaría con añadir una función `cards.js` y una colección `cards`.

## Añadir un TCG nuevo

1. Añade un objeto en `netlify/functions/_lib/games.js` (clave, nombre, zonas del mazo, formatos y color).
2. Añade su proveedor en `public/js/card-providers.js`.
3. (Opcional) Añade sus reglas de mazo en `deckHints` de `public/js/deck-builder.js`.

La colección `games` solo se siembra cuando está vacía; si ya tienes datos en Atlas, inserta el documento nuevo allí o borra la colección para que se regenere.
