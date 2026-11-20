# TCG Manager

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
│   ├── css/  base.css · login.css · home.css · app.css
│   ├── js/   api.js · ui.js · session.js · auth.js · home.js
│   │         collection.js · deck-builder.js · card-providers.js
│   └── assets/img/logo.svg
└── netlify/functions/           # backend serverless
    ├── _lib/ db.js · auth.js · http.js · games.js
    ├── auth-register.js · auth-login.js · auth-logout.js · auth-me.js
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
npx netlify dev           # http://localhost:8888
```

Para generar un `JWT_SECRET` aleatorio:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## 3. Desplegar (GitHub → Netlify)

1. Sube el proyecto a GitHub (el `.gitignore` ya excluye `.env`; comprueba que no se sube).
2. En Netlify: **Add new site → Import from Git** y elige el repositorio. `netlify.toml` ya indica la carpeta pública y la de funciones.
3. **Site configuration → Environment variables** y añade, marcándolas como *secret*:
   - `MONGODB_URI`
   - `JWT_SECRET`
   - `MONGODB_DB` (opcional, por defecto `tcgmanager`)
4. Haz un nuevo deploy para que las funciones lean las variables.

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

| TCG | API |
|-----|-----|
| MTG | Scryfall |
| Yu-Gi-Oh! | YGOPRODeck |
| Digimon | digimoncard.io |

Tú solo guardas lo que posee cada usuario (`usercards`) y sus mazos (`decks`), referenciando cada carta por su `cardId`. Si una API cambia sus campos o sus condiciones de acceso, solo hay que tocar `card-providers.js`. Si más adelante quieres cachear el catálogo en Atlas, bastaría con añadir una función `cards.js` y una colección `cards`.

## Añadir un TCG nuevo

1. Añade un objeto en `netlify/functions/_lib/games.js` (clave, nombre, zonas del mazo, formatos y color).
2. Añade su proveedor en `public/js/card-providers.js`.
3. (Opcional) Añade sus reglas de mazo en `deckHints` de `public/js/deck-builder.js`.

La colección `games` solo se siembra cuando está vacía; si ya tienes datos en Atlas, inserta el documento nuevo allí o borra la colección para que se regenere.
