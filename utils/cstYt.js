// Custom YouTube backend: https://testweb3.cstsc.in/yt (BlazeNXT self-hosted)
// No cookies, no yt-dlp — plain HTTP proxy streams from the API itself.
const CST_BASE = (process.env.CST_YT_BASE || "https://testweb3.cstsc.in/yt").replace(/\/+$/, "");
const REGION = process.env.CST_YT_REGION || "IN";

const api = async (action, params = {}, timeoutMs = 45000) => {
	const u = new URL(`${CST_BASE}/api.php`);
	u.searchParams.set("action", action);
	u.searchParams.set("region", REGION);
	for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
	const res = await fetch(u, {
		headers: { Accept: "application/json" },
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!res.ok) throw new Error(`CST API HTTP ${res.status}`);
	const json = await res.json();
	if (!json.ok) throw new Error(json.error?.message || "CST API error");
	return json.data;
};

// Title/search → first video { id, title, duration, url }
export const cstSearchFirst = async (query) => {
	const data = await api("search", { q: query });
	const vids = data?.videos || data?.results || [];
	const v = vids.find((x) => x.id);
	if (!v) throw new Error("No results found");
	return {
		id: v.id,
		title: v.title || "Unknown",
		duration: parseDuration(v.duration),
		url: `https://www.youtube.com/watch?v=${v.id}`,
	};
};

const parseDuration = (d) => {
	if (typeof d === "number") return d;
	if (typeof d !== "string") return 0;
	const parts = d.split(":").map(Number).filter((n) => !Number.isNaN(n));
	return parts.reduce((acc, n) => acc * 60 + n, 0);
};

// Video info: { id, title, duration(sec), qualities[], recovery_stream }
export const cstVideoInfo = (id) => api("video", { id });

const toSec = (d) => (typeof d === "number" ? d : parseDuration(d));

// Best progressive (muxed) mp4 URL — stream.php proxy, no cookies needed.
export const cstProgressiveUrl = (info) => {
	const abs = (u) => (u?.startsWith("http") ? u : `${CST_BASE}/${u?.replace(/^\/+/, "")}`);
	if (info?.recovery_stream?.url) return abs(info.recovery_stream.url);
	const prog = (info?.qualities || []).filter((q) => q.type === "progressive" && q.url);
	if (prog.length) {
		prog.sort((a, b) => (b.height || 0) - (a.height || 0));
		return abs(prog[0].url);
	}
	return null;
};

// Audio (m4a) BaseURL from the DASH manifest — pick smallest-quality manifest for speed.
export const cstAudioData = async (id) => {
	const info = await cstVideoInfo(id);
	const duration = toSec(info?.duration) || 0;
	const title = info?.title || "Unknown";
	const manifestPath = `${CST_BASE}/manifest.php?id=${id}&quality=360&region=${REGION}`;
	const res = await fetch(manifestPath, { signal: AbortSignal.timeout(45000) });
	if (!res.ok) throw new Error(`Manifest HTTP ${res.status}`);
	const xml = await res.text();
	const adaptationSets = xml.match(/<AdaptationSet[\s\S]*?<\/AdaptationSet>/g) || [];
	const audioSet = adaptationSets.find((s) => /contentType="audio"/.test(s) || /audio\//.test(s));
	if (!audioSet) throw new Error("No audio stream in manifest");
	const baseUrlM = audioSet.match(/<BaseURL>([\s\S]*?)<\/BaseURL>/);
	if (!baseUrlM) throw new Error("No audio BaseURL in manifest");
	const rel = baseUrlM[1].replace(/&amp;/g, "&").trim();
	const url = rel.startsWith("http") ? rel : `${CST_BASE}/${rel.replace(/^\/+/, "")}`;
	return { title, duration, url };
};

// Stream URL → file, with byte cap. Returns { path, bytes }.
import fs from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const downloadToFile = async (url, filePath, maxBytes = 60 * 1024 * 1024) => {
	const res = await fetch(url, {
		headers: { Accept: "*/*" },
		signal: AbortSignal.timeout(5 * 60 * 1000),
	});
	if (!res.ok && res.status !== 206) throw new Error(`Stream HTTP ${res.status}`);
	const len = Number(res.headers.get("content-length") || 0);
	if (len > maxBytes) throw new Error(`File too large: ${(len / 1048576).toFixed(1)}MB (max ${(maxBytes / 1048576) | 0}MB)`);
	let bytes = 0;
	const counter = new Transform({
		transform(chunk, _e, cb) {
			bytes += chunk.length;
			if (bytes > maxBytes) return cb(new Error(`File too large: >${(maxBytes / 1048576) | 0}MB`));
			cb(null, chunk);
		},
	});
	await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(filePath));
	return { path: filePath, bytes };
};
