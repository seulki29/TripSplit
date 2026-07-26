class FakeQuerySnapshot {
  constructor(docs) { this.docs = docs; }
  get empty() { return this.docs.length === 0; }
}

class FakeDocRef {
  constructor(store, path) {
    this.store = store;
    this.path = path;
    this.id = path.split('/').pop();
  }

  async get() {
    const data = this.store.data.get(this.path);
    return { exists: data !== undefined, id: this.id, data: () => data };
  }

  async set(value) {
    this.store.data.set(this.path, { ...value });
  }

  async update(patch) {
    const current = this.store.data.get(this.path) || {};
    this.store.data.set(this.path, { ...current, ...patch });
  }

  async delete() {
    this.store.data.delete(this.path);
  }

  collection(name) {
    return new FakeCollectionRef(this.store, `${this.path}/${name}`);
  }
}

class FakeCollectionRef {
  constructor(store, path, filters = []) {
    this.store = store;
    this.path = path;
    this._filters = filters;
  }

  doc(id) {
    const docId = id || `auto_${this.store.nextId++}`;
    return new FakeDocRef(this.store, `${this.path}/${docId}`);
  }

  async add(value) {
    const ref = this.doc();
    await ref.set(value);
    return ref;
  }

  where(field, op, value) {
    if (op !== '==') throw new Error(`FakeFirestore only supports '==', got '${op}'`);
    return new FakeCollectionRef(this.store, this.path, [...this._filters, { field, value }]);
  }

  async get() {
    const prefix = `${this.path}/`;
    const docs = [];
    for (const [path, data] of this.store.data.entries()) {
      if (!path.startsWith(prefix)) continue;
      if (path.slice(prefix.length).includes('/')) continue; // direct children only
      if (this._filters.every((f) => data[f.field] === f.value)) {
        docs.push({ id: path.split('/').pop(), data: () => data });
      }
    }
    return new FakeQuerySnapshot(docs);
  }
}

class FakeTransaction {
  constructor(store) { this.store = store; }

  async get(ref) { return ref.get(); }

  set(ref, value) {
    this.store.data.set(ref.path, { ...value });
  }

  update(ref, patch) {
    const current = this.store.data.get(ref.path) || {};
    this.store.data.set(ref.path, { ...current, ...patch });
  }
}

class FakeFirestore {
  constructor() {
    this.data = new Map();
    this.nextId = 1;
  }

  collection(name) {
    return new FakeCollectionRef(this, name);
  }

  async runTransaction(updateFunction) {
    return updateFunction(new FakeTransaction(this));
  }

  async recursiveDelete(ref) {
    const prefix = ref.path;
    for (const key of [...this.data.keys()]) {
      if (key === prefix || key.startsWith(`${prefix}/`)) this.data.delete(key);
    }
  }
}

module.exports = { FakeFirestore };
