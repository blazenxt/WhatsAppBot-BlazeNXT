// ── Local JSON-file database (MongoDB driver-compatible shim) ────────────────
// KataBump free host ke liye: real MongoDB ke bina, wahi collection API deta hai
// jo bot use karta hai (findOne/find/insertOne/updateOne/…). Data ./jsondb/*.json
// mein persist hota hai — restart ke baad bhi bana rehta hai.
// Agar future mein Atlas mile to original client.js waapis laga dena.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve(process.cwd(), "jsondb");
fs.mkdirSync(DATA_DIR, { recursive: true });

// ── persistence helpers (Date-aware) ─────────────────────────────────────────
const replacer = function (k, v) {
	const raw = this[k];
	return raw instanceof Date ? { __type: "Date", v: raw.toISOString() } : v;
};
const reviver = (k, v) => (v && v.__type === "Date" ? new Date(v.v) : v);

// ── deep helpers ─────────────────────────────────────────────────────────────
const clone = (v) => (v === undefined ? undefined : structuredClone(v));

const isOpSpec = (exp) =>
	exp && typeof exp === "object" && !(exp instanceof Date) && !(exp instanceof RegExp) &&
	!Array.isArray(exp) && Object.keys(exp).some((k) => k.startsWith("$"));

const deepEq = (a, b) => {
	if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
	if (a === b) return true;
	if (typeof a !== typeof b || a === null || b === null) return false;
	if (typeof a !== "object") return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const ka = Object.keys(a), kb = Object.keys(b);
	if (ka.length !== kb.length) return false;
	return ka.every((k) => deepEq(a[k], b[k]));
};

// "a.b.c" par saari values nikalta hai; beech mein array aaye to flatten karta hai
function* walkValues(obj, parts) {
	if (obj === undefined || obj === null) return;
	if (!parts.length) {
		if (Array.isArray(obj)) for (const it of obj) yield it;
		else yield obj;
		return;
	}
	if (Array.isArray(obj)) {
		for (const it of obj) yield* walkValues(it, parts);
		return;
	}
	const [head, ...rest] = parts;
	if (!(head in Object(obj))) return;
	yield* walkValues(obj[head], rest);
}
const getValues = (doc, dotPath) => [...walkValues(doc, dotPath.split("."))];

function testValue(actual, exp) {
	if (exp instanceof RegExp) return typeof actual === "string" && exp.test(actual);
	if (isOpSpec(exp)) return testOps(actual, exp);
	if (Array.isArray(exp)) return deepEq(actual, exp) || exp.some((e) => deepEq(actual, e));
	return deepEq(actual, exp);
}

function testOps(actual, ops) {
	for (const [op, v] of Object.entries(ops)) {
		switch (op) {
			case "$eq": if (!testValue(actual, v)) return false; break;
			case "$ne":
				if (Array.isArray(v) ? (Array.isArray(actual) ? deepEq(actual, v) : false) : testValue(actual, v)) return false;
				break;
			case "$in": if (!v.some((e) => testValue(actual, e))) return false; break;
			case "$nin": if (v.some((e) => testValue(actual, e))) return false; break;
			case "$gt": if (!(cmpVal(actual, v) > 0)) return false; break;
			case "$gte": if (!(cmpVal(actual, v) >= 0)) return false; break;
			case "$lt": if (!(cmpVal(actual, v) < 0)) return false; break;
			case "$lte": if (!(cmpVal(actual, v) <= 0)) return false; break;
			case "$exists": if (!v) return false; break; // walkValues ne yield kiya → exists
			case "$type":
				if (v === "array" ? !Array.isArray(actual) : v === "string" ? typeof actual !== "string" : false) return false;
				break;
			case "$regex": {
				const re = v instanceof RegExp ? v : new RegExp(String(v), ops.$options || "");
				if (typeof actual !== "string" || !re.test(actual)) return false;
				break;
			}
			case "$options": break; // $regex ke saath handle ho gaya
			default: throw new Error(`jsondb: unsupported operator ${op}`);
		}
	}
	return true;
}
const cmpVal = (a, b) => {
	const av = a instanceof Date ? a.getTime() : a;
	const bv = b instanceof Date ? b.getTime() : b;
	return av > bv ? 1 : av < bv ? -1 : 0;
};

function matchDoc(doc, filter) {
	for (const [key, exp] of Object.entries(filter || {})) {
		if (key === "$or") { if (!exp.some((f) => matchDoc(doc, f))) return false; continue; }
		if (key === "$and") { if (!exp.every((f) => matchDoc(doc, f))) return false; continue; }
		if (key === "$nor") { if (exp.some((f) => matchDoc(doc, f))) return false; continue; }
		const vals = getValues(doc, key);
		if (isOpSpec(exp) && "$exists" in exp && !exp.$exists) { if (vals.length) return false; continue; }
		if (!vals.length) return false;
		// equality match: array field me koi ek element match kare to bhi true (mongo semantics)
		if (!vals.some((v) => testValue(v, exp))) return false;
	}
	return true;
}

// filter se positional-array match ka index nikaalne ke liye
function findPositionalIndex(arr, arrayPrefix, filter) {
	const subKeys = Object.entries(filter)
		.filter(([k]) => k.split(".").slice(0, -1).join(".") === arrayPrefix)
		.map(([k, v]) => [k.split(".").pop(), v]);
	if (!subKeys.length) return -1;
	return arr.findIndex((el) => subKeys.every(([sub, want]) => {
		const got = el?.[sub];
		if (isOpSpec(want)) {
			// positional "$" ke liye sirf equality-type conditions meaningful hain
			if ("$eq" in want) return deepEq(got, want.$eq);
			return false;
		}
		return deepEq(got, want);
	}));
}

function applyAtPath(doc, dotPath, filter, fn) {
	const parts = dotPath.split(".");
	let cur = doc;
	let prefix = "";
	for (let i = 0; i < parts.length - 1; i++) {
		let k = parts[i];
		if (k === "$") {
			const idx = findPositionalIndex(Array.isArray(cur) ? cur : [], prefix, filter);
			if (idx === -1) throw new Error(`jsondb: positional match not found for "${dotPath}"`);
			k = String(idx);
		}
		if (cur[k] === undefined || cur[k] === null) cur[k] = /^\d+$/.test(parts[i + 1]) || parts[i + 1] === "$" ? [] : {};
		cur = cur[k];
		prefix = prefix ? prefix + "." + k : k;
	}
	let last = parts[parts.length - 1];
	if (last === "$") {
		const idx = findPositionalIndex(Array.isArray(cur) ? cur : [], prefix, filter);
		if (idx === -1) throw new Error(`jsondb: positional match not found for "${dotPath}"`);
		last = String(idx);
	}
	fn(cur, last);
}

function applyUpdate(doc, update, filter, isInsert) {
	if (!isOpSpec(update)) return clone(update); // replace-style (yahan use nahi hota, safety)
	const out = doc;
	for (const [op, fields] of Object.entries(update)) {
		for (const [p, v] of Object.entries(fields || {})) {
			switch (op) {
				case "$set":
					applyAtPath(out, p, filter, (c, l) => { c[l] = clone(v); });
					break;
				case "$setOnInsert":
					if (isInsert) applyAtPath(out, p, filter, (c, l) => { c[l] = clone(v); });
					break;
				case "$inc":
					applyAtPath(out, p, filter, (c, l) => { c[l] = (typeof c[l] === "number" ? c[l] : 0) + v; });
					break;
				case "$push":
					applyAtPath(out, p, filter, (c, l) => {
						if (!Array.isArray(c[l])) c[l] = [];
						const items = v && v.$each ? v.$each : [v];
						c[l].push(...items.map(clone));
					});
					break;
				case "$pull":
					applyAtPath(out, p, filter, (c, l) => {
						if (Array.isArray(c[l])) c[l] = c[l].filter((el) => !testValue(el, v));
					});
					break;
				case "$addToSet":
					applyAtPath(out, p, filter, (c, l) => {
						if (!Array.isArray(c[l])) c[l] = [];
						const items = v && v.$each ? v.$each : [v];
						for (const it of items) if (!c[l].some((el) => deepEq(el, it))) c[l].push(clone(it));
					});
					break;
				case "$pullAll":
					applyAtPath(out, p, filter, (c, l) => {
						if (Array.isArray(c[l])) c[l] = c[l].filter((el) => !v.some((rem) => deepEq(el, rem)));
					});
					break;
				case "$unset":
					applyAtPath(out, p, filter, (c, l) => { delete c[l]; });
					break;
				default: throw new Error(`jsondb: unsupported update operator ${op}`);
			}
		}
	}
	return out;
}

function applyProjection(doc, projection) {
	if (!projection) return doc;
	const keys = Object.keys(projection);
	const includeMode = keys.some((k) => k !== "_id" && projection[k]);
	if (!includeMode) {
		const out = clone(doc);
		for (const k of keys) if (!projection[k]) delete out[k];
		return out;
	}
	const out = {};
	for (const k of keys) {
		if (!projection[k]) continue;
		if (k in doc) out[k] = clone(doc[k]);
	}
	if (projection._id !== 0 && "_id" in doc && !("_id" in out)) out._id = clone(doc._id);
	return out;
}

// ── aggregate pipeline (bot ke 3 pipelines ke liye kaafi) ────────────────────
function evalExpr(expr, doc) {
	if (typeof expr === "string") {
		if (expr.startsWith("$")) return getValues(doc, expr.slice(1))[0];
		return expr;
	}
	if (expr && typeof expr === "object") {
		const [op, arg] = Object.entries(expr)[0];
		if (op === "$split") { const [s, sep] = arg.map((a) => evalExpr(a, doc)); return String(s ?? "").split(sep); }
		if (op === "$arrayElemAt") { const [arr, idx] = arg.map((a) => evalExpr(a, doc)); return arr?.[idx]; }
		if (op === "$toLower") return String(evalExpr(arg, doc) ?? "").toLowerCase();
		throw new Error(`jsondb: unsupported expression ${op}`);
	}
	return expr;
}
function runAggregate(docs, pipeline) {
	let rows = docs.map(clone);
	for (const stage of pipeline) {
		const [op, spec] = Object.entries(stage)[0];
		if (op === "$match") rows = rows.filter((d) => matchDoc(d, spec));
		else if (op === "$sort") rows = sortDocs(rows, spec);
		else if (op === "$limit") rows = rows.slice(0, spec);
		else if (op === "$skip") rows = rows.slice(spec);
		else if (op === "$project") {
			rows = rows.map((d) => {
				const out = {};
				for (const [k, v] of Object.entries(spec)) {
					if (v === 1 || v === true) { if (k in d) out[k] = d[k]; }
					else out[k] = evalExpr(v, d);
				}
				return out;
			});
		} else if (op === "$group") {
			const map = new Map();
			for (const d of rows) {
				const id = spec._id === null ? null : evalExpr(spec._id, d);
				const key = JSON.stringify(id instanceof Date ? { $d: id.toISOString() } : id);
				if (!map.has(key)) {
					const g = { _id: id };
					for (const [f, acc] of Object.entries(spec)) {
						if (f === "_id") continue;
						const [aOp] = Object.keys(acc);
						g[f] = aOp === "$sum" ? 0 : undefined;
					}
					map.set(key, g);
				}
				const g = map.get(key);
				for (const [f, acc] of Object.entries(spec)) {
					if (f === "_id") continue;
					const [aOp, aVal] = Object.entries(acc)[0];
					if (aOp === "$sum") g[f] += typeof aVal === "number" ? aVal : Number(evalExpr(aVal, d)) || 0;
					else throw new Error(`jsondb: unsupported accumulator ${aOp}`);
				}
			}
			rows = [...map.values()];
		} else throw new Error(`jsondb: unsupported stage ${op}`);
	}
	return rows;
}

function sortDocs(docs, spec) {
	const entries = Object.entries(spec);
	return docs.slice().sort((a, b) => {
		for (const [k, dir] of entries) {
			const av = getValues(a, k)[0], bv = getValues(b, k)[0];
			const c = cmpVal(av ?? null, bv ?? null);
			if (c) return dir === -1 ? -c : c;
		}
		return 0;
	});
}

// ── cursor ────────────────────────────────────────────────────────────────────
class Cursor {
	constructor(docs, opts) { this._docs = docs; this._proj = opts?.projection; }
	sort(spec) { this._docs = sortDocs(this._docs, spec); return this; }
	skip(n) { this._docs = this._docs.slice(n); return this; }
	limit(n) { this._docs = this._docs.slice(0, n); return this; }
	project(p) { this._proj = p; return this; }
	async toArray() { return this._docs.map((d) => applyProjection(clone(d), this._proj)); }
	async next() { return (await this.toArray())[0] ?? null; }
	[Symbol.asyncIterator]() {
		let i = 0; const self = this;
		return { async next() { const arr = await self.toArray(); return i < arr.length ? { value: arr[i++], done: false } : { value: undefined, done: true }; } };
	}
}

// ── collection ────────────────────────────────────────────────────────────────
let idCounter = 0;
const genId = () => `${Date.now().toString(16)}${(process.pid % 65536).toString(16).padStart(4, "0")}${(idCounter++ % 0xffffff).toString(16).padStart(6, "0")}`.slice(0, 24);

class LocalCollection {
	constructor(name) {
		this.name = name;
		this.file = path.join(DATA_DIR, `${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
		this.docs = [];
		this.byId = new Map();
		this._dirty = false;
		this._timer = null;
		try {
			if (fs.existsSync(this.file)) {
				this.docs = JSON.parse(fs.readFileSync(this.file, "utf8"), reviver) || [];
			}
		} catch (e) {
			console.error(`[jsondb] ${name} load failed, starting empty:`, e.message);
			this.docs = [];
		}
		for (const d of this.docs) this.byId.set(String(d._id), d);
		collections.set(name, this);
	}
	markDirty() {
		this._dirty = true;
		if (!this._timer) {
			this._timer = setTimeout(() => { this._timer = null; this.flushSync(); }, 800);
			this._timer.unref?.();
		}
	}
	flushSync() {
		if (!this._dirty) return;
		try {
			const tmp = this.file + ".tmp";
			fs.writeFileSync(tmp, JSON.stringify(this.docs, replacer));
			fs.renameSync(tmp, this.file);
			this._dirty = false;
		} catch (e) {
			console.error(`[jsondb] ${this.name} save failed:`, e.message);
		}
	}

	// ── MongoDB-compatible API ──
	async findOne(filter = {}, opts = {}) {
		const d = this.docs.find((x) => matchDoc(x, filter));
		return d ? applyProjection(clone(d), opts.projection) : null;
	}
	find(filter = {}, opts = {}) {
		return new Cursor(this.docs.filter((x) => matchDoc(x, filter)), opts);
	}
	async insertOne(doc) {
		const d = clone(doc);
		if (d._id === undefined) d._id = genId();
		if (this.byId.has(String(d._id))) { const e = new Error("E11000 duplicate key"); e.code = 11000; throw e; }
		this.docs.push(d);
		this.byId.set(String(d._id), d);
		this.markDirty();
		return { acknowledged: true, insertedId: clone(d._id) };
	}
	async insertMany(arr) {
		const ids = [];
		for (const d of arr) ids.push((await this.insertOne(d)).insertedId);
		return { acknowledged: true, insertedIds: ids, insertedCount: ids.length };
	}
	#target(filter, upsert = false) {
		const idx = this.docs.findIndex((x) => matchDoc(x, filter));
		if (idx !== -1) return { doc: this.docs[idx], isInsert: false };
		if (!upsert) return { doc: null, isInsert: false };
		const base = {};
		for (const [k, v] of Object.entries(filter || {})) {
			if (k.startsWith("$") || isOpSpec(v) || v instanceof RegExp) continue;
			if (k.includes(".")) continue;
			base[k] = clone(v);
		}
		return { doc: base, isInsert: true, newDoc: true };
	}
	async updateOne(filter, update, opts = {}) {
		const { doc, isInsert, newDoc } = this.#target(filter, opts.upsert);
		if (!doc) return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
		applyUpdate(doc, update, filter, isInsert);
		let upsertedId;
		if (newDoc) {
			if (doc._id === undefined) doc._id = genId();
			if (this.byId.has(String(doc._id))) return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
			this.docs.push(doc);
			this.byId.set(String(doc._id), doc);
			upsertedId = clone(doc._id);
		}
		this.markDirty();
		return { acknowledged: true, matchedCount: newDoc ? 0 : 1, modifiedCount: newDoc ? 0 : 1, upsertedCount: newDoc ? 1 : 0, upsertedId };
	}
	async updateMany(filter, update, opts = {}) {
		let n = 0;
		const matches = this.docs.filter((x) => matchDoc(x, filter));
		for (const d of matches) { applyUpdate(d, update, filter, false); n++; }
		if (!n && opts.upsert) return this.updateOne(filter, update, opts);
		if (n) this.markDirty();
		return { acknowledged: true, matchedCount: n, modifiedCount: n, upsertedCount: 0 };
	}
	async findOneAndUpdate(filter, update, opts = {}) {
		const before = this.docs.find((x) => matchDoc(x, filter));
		let doc = before, isInsert = false;
		if (!doc && opts.upsert) {
			doc = {};
			for (const [k, v] of Object.entries(filter || {})) {
				if (k.startsWith("$") || isOpSpec(v) || v instanceof RegExp || k.includes(".")) continue;
				doc[k] = clone(v);
			}
			isInsert = true;
		}
		if (!doc) return null;
		applyUpdate(doc, update, filter, isInsert);
		if (isInsert) {
			if (doc._id === undefined) doc._id = genId();
			this.docs.push(doc);
			this.byId.set(String(doc._id), doc);
		}
		this.markDirty();
		return clone(opts.returnDocument === "before" && before ? before : doc);
	}
	async deleteOne(filter) {
		const idx = this.docs.findIndex((x) => matchDoc(x, filter));
		if (idx === -1) return { acknowledged: true, deletedCount: 0 };
		this.byId.delete(String(this.docs[idx]._id));
		this.docs.splice(idx, 1);
		this.markDirty();
		return { acknowledged: true, deletedCount: 1 };
	}
	async deleteMany(filter) {
		const before = this.docs.length;
		const kept = [];
		for (const d of this.docs) {
			if (matchDoc(d, filter)) this.byId.delete(String(d._id));
			else kept.push(d);
		}
		this.docs = kept;
		if (kept.length !== before) this.markDirty();
		return { acknowledged: true, deletedCount: before - kept.length };
	}
	async countDocuments(filter = {}) {
		if (!Object.keys(filter).length) return this.docs.length;
		return this.docs.filter((x) => matchDoc(x, filter)).length;
	}
	async estimatedDocumentCount() { return this.docs.length; }
	async distinct(field, filter = {}) {
		const set = new Set();
		for (const d of this.docs) if (matchDoc(d, filter)) for (const v of getValues(d, field)) set.add(v);
		return [...set];
	}
	aggregate(pipeline = []) {
		return new Cursor(runAggregate(this.docs, pipeline), null);
	}
	async bulkWrite(ops = []) {
		let modified = 0, upserted = 0, deleted = 0, inserted = 0, matched = 0;
		for (const op of ops) {
			if (op.updateOne) {
				const r = await this.updateOne(op.updateOne.filter, op.updateOne.update, op.updateOne);
				modified += r.modifiedCount; upserted += r.upsertedCount; matched += r.matchedCount;
			} else if (op.insertOne) { await this.insertOne(op.insertOne.document); inserted++; }
			else if (op.deleteOne) { deleted += (await this.deleteOne(op.deleteOne.filter)).deletedCount; }
			else throw new Error("jsondb: unsupported bulk op");
		}
		return { acknowledged: true, matchedCount: matched, modifiedCount: modified, upsertedCount: upserted, deletedCount: deleted, insertedCount: inserted };
	}
	async createIndex() { return "ok"; }
	async createIndexes() { return "ok"; }
	async drop() { this.docs = []; this.byId.clear(); this.markDirty(); return true; }
}

// ── client facade ─────────────────────────────────────────────────────────────
const collections = new Map();
const dbCache = new Map();
const makeDb = (name) => ({
	collection: (coll) => {
		const key = `${name}.${coll}`;
		if (!collections.has(key)) new LocalCollection(key);
		return collections.get(key);
	},
	createCollection: async (coll) => makeDb(name).collection(coll),
	listCollections: () => ({ toArray: async () => [...collections.keys()].map((n) => ({ name: n })) }),
	databaseName: name,
});

const client = {
	db(name) {
		if (!dbCache.has(name)) dbCache.set(name, makeDb(name));
		return dbCache.get(name);
	},
	async connect() { return client; },
	async close() {},
};

// process band hote waqt pending data flush kar do
const flushAll = () => { for (const c of collections.values()) c.flushSync(); };
process.once("exit", flushAll);
process.once("SIGINT", () => { flushAll(); process.exit(0); });
process.once("SIGTERM", () => { flushAll(); process.exit(0); });

console.log("✅ [jsondb] Local JSON database ready at", DATA_DIR);
export default client;
