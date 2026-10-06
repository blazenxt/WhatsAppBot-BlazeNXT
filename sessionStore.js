// Tiny express-session store backed by the local jsondb client.
import session from "express-session";
import mdClient from "./db/client.js";

const sessions = mdClient.db("MyBotDataDB").collection("ExpressSessions");

export default class JsonSessionStore extends session.Store {
	constructor(options = {}) {
		super(options);
		this.ttl = (options.ttl ?? 86400) * 1000;
	}
	async get(sid, cb) {
		try {
			const doc = await sessions.findOne({ _id: sid });
			if (!doc) return cb(null, null);
			if (doc.expiresAt && Date.now() > new Date(doc.expiresAt).getTime()) {
				await sessions.deleteOne({ _id: sid });
				return cb(null, null);
			}
			cb(null, doc.data);
		} catch (e) { cb(e); }
	}
	async set(sid, sess, cb) {
		try {
			const maxAge = sess?.cookie?.maxAge ?? this.ttl;
			await sessions.updateOne(
				{ _id: sid },
				{ $set: { data: sess, expiresAt: new Date(Date.now() + maxAge) } },
				{ upsert: true }
			);
			cb?.(null);
		} catch (e) { cb?.(e); }
	}
	async destroy(sid, cb) {
		try { await sessions.deleteOne({ _id: sid }); cb?.(null); }
		catch (e) { cb?.(e); }
	}
	async touch(sid, sess, cb) {
		try {
			const maxAge = sess?.cookie?.maxAge ?? this.ttl;
			await sessions.updateOne({ _id: sid }, { $set: { expiresAt: new Date(Date.now() + maxAge) } });
			cb?.(null);
		} catch (e) { cb?.(e); }
	}
}
