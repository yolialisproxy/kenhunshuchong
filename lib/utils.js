import initializeApp from 'firebase/app';
import getDatabase, ref, push, set, get, update, remove, runTransaction from 'firebase/database';


let appInstance;
let dbInstance;

function validateEnv() {
  const required = [
    'FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_DATABASE_URL',
    'FIREBASE_PROJECT_ID', 'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_MESSAGING_SENDER_ID', 'FIREBASE_APP_ID'
  ];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) {
    throw new Error('Missing environment variables: ' + missing.join(', '));
  }
}

export async function initFirebase() {
  if (dbInstance) return dbInstance;
  try {
    validateEnv();
    const firebaseConfig = {
      apiKey: process.env.FIREBASE_API_KEY, authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      databaseURL: process.env.FIREBASE_DATABASE_URL, projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID, appId: process.env.FIREBASE_APP_ID
    };
    appInstance = initializeApp(firebaseConfig);
    dbInstance = getDatabase(appInstance);
    return dbInstance;
  } catch (err) {
    throw err;
  }
}

export async function withTimeout(promise, ms) {
  const timeoutMilliseconds = ms || CONFIG.TIMEOUT;
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => { reject(new Error('Firebase operation timed out')); }, timeoutMilliseconds);
  });
  return Promise.race([promise, timeoutPromise]);
}

export async function read(path, options) {
  const opts = options || {};
  const once = (opts.once === undefined) ? true : opts.once;
  const timeout = opts.timeout || CONFIG.TIMEOUT;
  try {
    const fbDb = await initFirebase();
    const dbRef = ref(fbDb, path);
    const result = await withTimeout(
      once ? get(dbRef) : dbRef.once('value'), timeout
    );
    const snapshot = result;
    return snapshot.val() || null;
  } catch (err) {
    throw err;
  }
}

export async function write(path, data, options) {
  const opts = options || {};
  const method = opts.method || 'set';
  const timeout = opts.timeout || CONFIG.TIMEOUT;
  try {
    const fbDb = await initFirebase();
    let writePromise;
    if (method === 'set') {
      writePromise = set(ref(fbDb, path), data);
    } else if (method === 'update') {
      writePromise = update(ref(fbDb, path), data);
    } else if (method === 'push') {
      const newRef = push(ref(fbDb, path), data);
      return await withTimeout(newRef, timeout);
    } else {
      throw new Error('Unsupported write method');
    }
    await withTimeout(writePromise, timeout);
    return;
  } catch (err) {
    throw err;
  }
}

export async function transaction(path, updateFn, options) {
  const opts = options || {};
  const timeout = opts.timeout || CONFIG.TIMEOUT;
  try {
    const fbDb = await initFirebase();
    const result = await withTimeout(
      runTransaction(ref(fbDb, path), (currentValue) => { return updateFn(currentValue || null); }), timeout
    );
    return result;
  } catch (err) {
    throw err;
  }
}

export async function del(path, options) {
  const opts = options || {};
  const timeout = opts.timeout || CONFIG.TIMEOUT;
  try {
    const fbDb = await initFirebase();
    await withTimeout(remove(ref(fbDb, path)), timeout);
  } catch (err) {
    throw err;
  }
}
