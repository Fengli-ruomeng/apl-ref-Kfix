const path = require("path");
const { ensureMods, writeAtomically } = require("./ensureMods");

const files = [
    {
        url: "https://raw.githubusercontent.com/ppy/osu-server-spectator/master/osu.Server.Spectator/Hubs/Referee/IRefereeHubClient.cs",
        dest: "IRefereeHubClient.cs",
    },
    {
        url: "https://raw.githubusercontent.com/ppy/osu-server-spectator/master/osu.Server.Spectator/Hubs/Referee/IRefereeHubServer.cs",
        dest: "IRefereeHubServer.cs",
    },
];

async function download(url, dest) {
    const response = await fetch(url); // fetch follows redirects, https.get doesnt
    if (!response.ok) throw new Error(`Could not download ${url}: HTTP ${response.status}`);
    // temp first so a failed dl cant nuke the file
    await writeAtomically(dest, await response.text());
}

async function run() {
    for (const f of files) {
        await download(f.url, path.resolve(__dirname, f.dest));
        console.log(`Downloaded ${f.dest}`);
    }
    await ensureMods({ force: true });
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
