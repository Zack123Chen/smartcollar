const DB_NAME = "careguard-live";
const DB_VERSION = 1;
const TELEMETRY_STORE = "telemetry";
const MISSION_STORE = "missions";

let dbPromise;

function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TELEMETRY_STORE)) {
        const telemetry = db.createObjectStore(TELEMETRY_STORE, { keyPath: "id", autoIncrement: true });
        telemetry.createIndex("timestamp", "timestamp");
      }
      if (!db.objectStoreNames.contains(MISSION_STORE)) {
        const missions = db.createObjectStore(MISSION_STORE, { keyPath: "id", autoIncrement: true });
        missions.createIndex("createdAt", "createdAt");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveTelemetrySample(sample) {
  const db = await openDatabase();
  const tx = db.transaction(TELEMETRY_STORE, "readwrite");
  tx.objectStore(TELEMETRY_STORE).add(sample);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getRecentTelemetry(limit = 40) {
  const db = await openDatabase();
  const tx = db.transaction(TELEMETRY_STORE, "readonly");
  const index = tx.objectStore(TELEMETRY_STORE).index("timestamp");
  const samples = [];

  return new Promise((resolve, reject) => {
    const request = index.openCursor(null, "prev");
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || samples.length >= limit) {
        resolve(samples.reverse());
        return;
      }
      samples.push(cursor.value);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getTelemetryCount() {
  const db = await openDatabase();
  const tx = db.transaction(TELEMETRY_STORE, "readonly");
  return requestToPromise(tx.objectStore(TELEMETRY_STORE).count());
}

export async function saveMission(mission) {
  const db = await openDatabase();
  const tx = db.transaction(MISSION_STORE, "readwrite");
  const storedMission = {
    ...mission,
    createdAt: mission.createdAt || Date.now()
  };
  await requestToPromise(tx.objectStore(MISSION_STORE).add(storedMission));
  return storedMission;
}

export async function getAllMissions() {
  const db = await openDatabase();
  const tx = db.transaction(MISSION_STORE, "readonly");
  const missions = await requestToPromise(tx.objectStore(MISSION_STORE).getAll());
  return missions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function ensureSeedMissions(seedMissions) {
  const db = await openDatabase();
  const tx = db.transaction(MISSION_STORE, "readonly");
  const count = await requestToPromise(tx.objectStore(MISSION_STORE).count());
  if (count > 0) return;

  for (const mission of seedMissions) {
    await saveMission({
      ...mission,
      builtIn: true,
      createdAt: mission.createdAt || Date.now()
    });
  }
}

export async function exportStoredData() {
  const db = await openDatabase();
  const telemetryTx = db.transaction(TELEMETRY_STORE, "readonly");
  const missionsTx = db.transaction(MISSION_STORE, "readonly");
  const [telemetry, missions] = await Promise.all([
    requestToPromise(telemetryTx.objectStore(TELEMETRY_STORE).getAll()),
    requestToPromise(missionsTx.objectStore(MISSION_STORE).getAll())
  ]);

  return {
    exportedAt: new Date().toISOString(),
    telemetry,
    missions
  };
}
