// Conexión a MongoDB Atlas.
// Las credenciales se leen SOLO de variables de entorno (nunca del código).
const { MongoClient } = require('mongodb');

let cachedClient = null;
let indexesReady = false;

async function getDb() {
  if (!process.env.MONGODB_URI) {
    throw new Error('Falta la variable de entorno MONGODB_URI');
  }

  // Reutilizamos la conexión entre invocaciones de la función (serverless)
  if (!cachedClient) {
    cachedClient = new MongoClient(process.env.MONGODB_URI, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 8000,
    });
    await cachedClient.connect();
  }

  const db = cachedClient.db(process.env.MONGODB_DB || 'tcgmanager');

  if (!indexesReady) {
    await ensureIndexes(db);
    indexesReady = true;
  }
  return db;
}

async function ensureIndexes(db) {
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
  await db.collection('users').createIndex({ username: 1 }, { unique: true });
  // Nombre de usuario único SIN distinguir mayúsculas ("Ana" y "ana" son el mismo).
  // Es un índice adicional con nombre propio; si ya hubiera nombres duplicados por
  // mayúsculas no se puede crear, así que solo avisamos en el log y seguimos.
  try {
    await db.collection('users').createIndex(
      { username: 1 },
      { unique: true, name: 'username_ci_unique', collation: { locale: 'en', strength: 2 } }
    );
  } catch (err) {
    console.warn('No se pudo crear el índice único de username sin distinguir mayúsculas:', err.message);
  }
  // Único solo cuando googleId existe (las cuentas con contraseña no lo tienen)
  await db.collection('users').createIndex(
    { googleId: 1 },
    { unique: true, partialFilterExpression: { googleId: { $type: 'string' } } }
  );

  await db.collection('usercards').createIndex(
    { userId: 1, game: 1, cardId: 1, language: 1, finish: 1, condition: 1 },
    { unique: true }
  );
  await db.collection('usercards').createIndex({ userId: 1, game: 1, name: 1 });

  await db.collection('decks').createIndex({ userId: 1, game: 1, updatedAt: -1 });

  await db.collection('games').createIndex({ key: 1 }, { unique: true });
}

module.exports = { getDb };
