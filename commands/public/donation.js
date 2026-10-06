const handler = async (sock, msg, from, args, msgInfoObj) => {
	const { sendMessageWTyping } = msgInfoObj;

	await sendMessageWTyping(
		from,
		{
			text: `*💜 Support BlazeNXT Bot*

If you enjoy using this bot and want to support its development, reach out to us:

🌐 Website: www.blazenxt.in

_Developed by BlazeNXT_`,
		},
		{ quoted: msg }
	);
};

export default () => ({
	cmd: ["donate", "donation"],
	desc: "Support the bot via BlazeNXT.",
	usage: "donate",
	handler,
});
