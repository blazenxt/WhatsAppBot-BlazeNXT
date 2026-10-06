import fs from "fs";
import memoryManager from "../../../utils/memory.js";
import { readFileEfficiently, isValidVideoFile } from "../../../utils/file.js";
import { parseYouTubeUrl } from "../../../utils/ytdlp.js";
import { cstSearchFirst, cstVideoInfo, cstProgressiveUrl, downloadToFile } from "../../../utils/cstYt.js";

const getRandom = (ext) => memoryManager.generateTempFileName(ext);
const MAX_VIDEO_SECONDS = 30 * 60;
const MAX_BYTES = 60 * 1024 * 1024;
const ytId = (u) => (u.match(/[?&]v=([A-Za-z0-9_-]{11})/) || u.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) || [])[1];

const handler = async (sock, msg, from, args, msgInfoObj) => {
	const { sendMessageWTyping, command, evv } = msgInfoObj;

	if (command != "vs") {
		if (!args[0] || !parseYouTubeUrl(args[0])) {
			return sendMessageWTyping(from, { text: `Enter a youtube link after yt` }, { quoted: msg });
		}
	}

	let id;
	if (command == "vs") {
		if (!args[0]) return sendMessageWTyping(from, { text: `Enter something to search` }, { quoted: msg });
		try {
			const found = await cstSearchFirst(evv);
			id = found.id;
		} catch (searchError) {
			console.error("Video search error:", searchError);
			return sendMessageWTyping(from, { text: `❌ No video found for: ${evv}` }, { quoted: msg });
		}
	} else {
		id = ytId(parseYouTubeUrl(args[0]));
	}

	const fileDown = getRandom(".mp4");

	try {
		await sendMessageWTyping(from, { text: `⏳ Processing video... Please wait.` }, { quoted: msg });

		let title = "Unknown Video";
		let duration = 0;
		let streamUrl = null;
		try {
			const info = await cstVideoInfo(id);
			title = info.title || "Unknown Video";
			duration = typeof info.duration === "number" ? info.duration : 0;
			streamUrl = cstProgressiveUrl(info);
		} catch (infoError) {
			console.log("Info fetch failed:", infoError.message);
		}

		if (duration > MAX_VIDEO_SECONDS) {
			return sendMessageWTyping(
				from,
				{ text: `❌ Video is too long (${Math.round(duration / 60)} minutes). Maximum 30 minutes allowed.` },
				{ quoted: msg }
			);
		}
		if (!streamUrl) {
			return sendMessageWTyping(from, { text: "❌ No downloadable stream found for this video." }, { quoted: msg });
		}

		console.log("Downloading:", title, id);
		const { bytes } = await downloadToFile(streamUrl, fileDown, MAX_BYTES);

		if (!fs.existsSync(fileDown)) {
			return sendMessageWTyping(from, { text: "❌ Video file was not created." }, { quoted: msg });
		}
		const stats = await fs.promises.stat(fileDown);
		if (stats.size === 0) {
			return sendMessageWTyping(from, { text: "❌ Video file is empty." }, { quoted: msg });
		}
		if (!isValidVideoFile(fileDown)) {
			return sendMessageWTyping(from, { text: "❌ Video file is not valid or not supported." }, { quoted: msg });
		}

		const fileSizeMB = stats.size / (1024 * 1024);
		const videoBuffer = await readFileEfficiently(fileDown);
		await sendMessageWTyping(
			from,
			{
				video: videoBuffer,
				caption: `🎥 *${title}*\n📊 Size: ${fileSizeMB.toFixed(2)}MB`,
				mimetype: "video/mp4",
			},
			{ quoted: msg }
		);
	} catch (err) {
		console.error("YTDL Handler Error:", err);
		const m = (err.message || "").toLowerCase();
		let errorMsg = "❌ Download failed. ";
		if (m.includes("too large")) errorMsg += err.message;
		else if (m.includes("timeout") || m.includes("abort")) errorMsg += "Server timed out. Please try again.";
		else errorMsg += "Please try with a different video.";
		sendMessageWTyping(from, { text: errorMsg }, { quoted: msg });
	} finally {
		memoryManager.safeUnlink(fileDown);
	}
};

export default () => ({
	cmd: ["yt", "ytv", "vs"],
	desc: "Download a YouTube video (or search with vs).",
	usage: "yt <youtube link> | vs <search terms>",
	handler,
});
