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
│   ├── js/   api.js · ui.js · session.js · auth.js · home.js
│   │         collection.js · deck-builder.js · card-providers.js
│   └── assets/img/logo.svg
└── netlify/functions/           # backend serverless
    ├── _lib/ db.js · auth.js · http.js · games.js
    ├── auth-register.js · auth-login.js · auth-logout.js · auth-me.js
    ├── auth-google.js · auth-config.js
    ├── games.js · collection.js · decks.js
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

## Seguridad implementada

- Contraseñas con **bcrypt** (coste 12); nunca en texto plano.
- Sesión con **JWT en cookie `HttpOnly; Secure; SameSite=Strict`** (el JS del navegador no puede leerla).
- Mensaje de error genérico en el login (no revela si el usuario existe).
- Cada consulta filtra por el `userId` **del token**, nunca por uno enviado por el cliente.
- Validación y límites de tamaño en el servidor; las escrituras exigen `Content-Type: application/json`.
- El DOM se construye con `textContent` (sin `innerHTML` con datos de usuario) para evitar XSS.

Pendiente recomendado antes de producción: limitar intentos de login (rate limiting), por ejemplo con un contador por IP/usuario en MongoDB o con un servicio externo, ya que las funciones serverless no comparten memoria entre instancias.

## Catálogo de cartas

El catálogo **no se guarda** en tu base de datos; se consulta desde el navegador a APIs públicas (`public/js/card-providers.js`):

| TCG       | API            |
| --------- | -------------- |
| MTG       | Scryfall       |
| Yu-Gi-Oh! | YGOPRODeck     |
| Digimon   | digimoncard.io |

Tú solo guardas lo que posee cada usuario (`usercards`) y sus mazos (`decks`), referenciando cada carta por su `cardId`. Si una API cambia sus campos o sus condiciones de acceso, solo hay que tocar `card-providers.js`. Si más adelante quieres cachear el catálogo en Atlas, bastaría con añadir una función `cards.js` y una colección `cards`.

## Añadir un TCG nuevo

1. Añade un objeto en `netlify/functions/_lib/games.js` (clave, nombre, zonas del mazo, formatos y color).
2. Añade su proveedor en `public/js/card-providers.js`.
3. (Opcional) Añade sus reglas de mazo en `deckHints` de `public/js/deck-builder.js`.

La colección `games` solo se siembra cuando está vacía; si ya tienes datos en Atlas, inserta el documento nuevo allí o borra la colección para que se regenere.
