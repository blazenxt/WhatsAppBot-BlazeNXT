const handler = async (sock, msg, from, args, msgInfoObj) => {
	const { sendMessageWTyping } = msgInfoObj;

	const text = `*🤖 BlazeNXT Bot*

╭───────────────────────────
│ *🌐 Website*
│ www.blazenxt.in
│
│ *🧠 AI Platform*
│ ai.blazenxt.in
│
│ *🎥 YouTube Platform*
│ testweb3.cstsc.in/yt
╰───────────────────────────

_Developed by BlazeNXT_`;

	await sendMessageWTyping(from, { text }, { quoted: msg });
};

export default () => ({
	cmd: ["dev", "developer"],
	desc: "Show info about the developer.",
	usage: "dev | developer",
	handler,
});
