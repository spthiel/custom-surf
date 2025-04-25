#!/usr/bin/env bun
import {$, BunFile, ShellError} from 'bun'
import Database from 'bun:sqlite'

// region Arguments

const readProp = Bun.argv[2]
const setProperty = Bun.argv[3]
const windowID = Bun.argv[4]

console.log("Called bmark_history", Bun.argv);

// endregion

// region Styling
const font = '"comic code ligatures"'

const dmenuCommand = [
    `dmenu`,
    `-w ${windowID}`,
    `-fn ${font}`,
    `-c -l 10`,
    `-bw 5`
].join(" ");

const bookmarkIcon = "\uD83D\uDCC4";

// endregion

// region Database

const dbFile = "/home/n/apps/surf/scripts/config/bookmarks.sqlite"

const database = new Database(dbFile, {create: true, strict: true})
setupDB();

function setupDB() {
    database.query(`
        CREATE TABLE IF NOT EXISTS history
        (
            value         VARCHAR(1024) PRIMARY KEY NOT NULL,
            bookmarked    TINYINT      DEFAULT 0    NOT NULL,
            bookmark_name VARCHAR(256) DEFAULT NULL
        )
    `).run();
}

function readHistory(): Map<string, string> {
    const data = database.query(`
        SELECT value, bookmark_name
        FROM history
        WHERE bookmarked = 0
        ORDER BY value
    `).all() as { value: string, bookmark_name: string }[]

    const out = new Map<string, string>()

    data.forEach(row => {
        out.set(row.bookmark_name, row.value);
    })

    return out;
}

function readBookmarks(): Map<string, string> {
    const data = database.query(`
        SELECT value, bookmark_name
        FROM history
        WHERE bookmarked = 1
        ORDER BY value
    `).all() as { value: string, bookmark_name: string }[]

    const out = new Map<string, string>()

    data.forEach(row => {
        out.set(row.bookmark_name, row.value);
    })

    return out;
}

function readBoth(): Map<string, string> {
    const data = database.query(`
        SELECT value, bookmark_name, bookmarked
        FROM history
        ORDER BY value
    `).all() as { value: string, bookmark_name: string, bookmarked: number }[]

    const out = new Map<string, string>()

    data.forEach(row => {
        if (row.bookmark_name) {
            if (row.bookmarked) {
                row.bookmark_name = `${bookmarkIcon} ${row.bookmark_name}`;
            }
            out.set(row.bookmark_name, row.value);
        } else {
            out.set(row.value, row.value);
        }
    })

    return out;
}

function save(value: string, bookmark: boolean, bookmarkName: string | null = null) {
    const bookmarkedParam = bookmark ? 1 : 0;

    return database.query(`
        INSERT OR
        REPLACE
        INTO history
        VALUES (:value,
                :bookmarked,
                :bookmarkName)
    `).run({value: value, bookmarked: bookmarkedParam, bookmarkName: bookmarkName})
}

function saveNew(value: string, bookmark: boolean, bookmarkName: string | null = null) {
    const bookmarkedParam = bookmark ? 1 : 0;

    try {
        database.query(`
            INSERT INTO history
            VALUES (:value,
                    :bookmarked,
                    :bookmarkName)
        `).run({value: value, bookmarked: bookmarkedParam, bookmarkName: bookmarkName})
    } catch {
    }
}

function remove(value: string) {
    return database.query(`
        DELETE
        FROM history
        WHERE value = :value
    `).run({value: value});
}

// endregion

// region Props

function isShellError(error: Error): error is ShellError {
    return "stderr" in error;
}

async function getProp(prop: string): Promise<string> {
    try {
        const result = (await $`xprop -id ${windowID} ${prop}`.quiet()).text("utf-8")

        const firstQuote = result.indexOf("\"");

        return result.substring(firstQuote + 1, result.indexOf("\"", firstQuote + 1));
    } catch (error) {
        processError(error);
    }
}

async function setProp(prop: string, value: string) {
    try {
        await $`xprop -id ${windowID} -f ${prop} 8u -set ${prop} "${value}"`
    } catch (error) {
        processError(error);
    }
}

// endregion

// region Shell

function processError(error: unknown): never {
    if (error instanceof Error && isShellError(error)) {
        if (error.stderr.toString().trim() !== "") {
            throw new Error(error.stderr.toString());
        } else {
            process.exit(1);
        }
    } else {
        throw error;
    }
}

// endregion

// region Dmenu

async function promptDmenu(prompt: string, additionalOptions: string = "", values: Map<string, string> | undefined = undefined): Promise<string> {
    try {
        if (values === undefined) {
            values = new Map<string, string>();
            const uri = await getProp("_SURF_URI");
            values.set(uri, uri);
        }
        const data = Buffer.from(Array.from(values.keys()).join("\n"), "utf-8")

        const value = (await $`${{raw: dmenuCommand}} ${{raw: additionalOptions}} -p ${prompt} < ${data}`.text()).trim()

        if (values.has(value)) {
            return values.get(value) as string;
        }

        return value;
    } catch (error) {
        processError(error);
    }
}

// endregion

function prependProtocol(uri: string) {
    if (uri.startsWith("http")) {
        return uri;
    }

    return "https://" + uri;
}

function getOptAndArg(result: string) {
    {
        // Check front
        const space = result.indexOf(" ");

        const part1 = result.substring(0, space);
        const part2 = result.substring(space + 1);

        if (part1.length === 1 || part1.startsWith("!")) {
            return [part1, part2];
        }
    }
    {
        // Check back
        const space = result.lastIndexOf(" ");

        const part1 = result.substring(0, space);
        const part2 = result.substring(space + 1);

        return [part2, part1]
    }
}

function matchesOperator(userInput: string, operator: string): boolean {
    if (userInput.startsWith("!")) {
        return operator.startsWith(userInput.substring(1));
    }

    if (userInput.length !== 1) {
        return false;
    }

    return operator.substring(0, 1) === userInput;
}

async function runEnhancedPrompt() {
    const values = readBoth();
    const currentURL = await getProp("_SURF_URI");
    values.set("Current: " + currentURL, currentURL)
    const result = (await promptDmenu("URI+:", "", values)).trim();
    if (!result.includes(" ")) {
        const uri = prependProtocol(result);
        saveNew(uri, false);
        await setProp("_SURF_GO", uri);
        return;
    }

    let [opt, arg] = getOptAndArg(result);

    if (values.has(arg)) {
        arg = values.get(arg) as string;
    }

    if (matchesOperator(opt, "nightly")) {
        const uri = `https://nightly.test.k8s.elo.dev/nightly-${arg.replace(".", "-")}/plugin/de.elo.ix.plugin.proxy/administration/`
        saveNew(`!n ${arg}`, false);
        await setProp("_SURF_GO", uri);
    } else if (matchesOperator(opt, "search")) {
        const uri = `https://search.elspeth.xyz/search?q=${arg}`
        await setProp("_SURF_GO", uri);
    } else if (matchesOperator(opt, "delete")) {
        remove(arg);
    } else if (matchesOperator(opt, "bookmarkless")) {
        const uri = prependProtocol(arg);
        await setProp("_SURF_GO", uri);
    } else if (matchesOperator(opt, "local")) {
        const uri = `http://elo-${arg.replace(".", "-")}.localhost/repository/plugin/de.elo.ix.plugin.proxy/administration/`
        saveNew(`!l ${arg}`, false);
        await setProp("_SURF_GO", uri);
    }
}

switch (readProp) {
    case "_SURF_BMARK": {
        const uri = await getProp("_SURF_URI");
        const values = new Map()
        values.set(bookmarkIcon, "''");
        const name = await promptDmenu("Bookmark name", "-l 0", values)
        save(uri, true, name);
        break;
    }
    case "_SURF_URI_RAW": {
        const uri = await promptDmenu("URI:");
        await setProp("_SURF_GO", uri);
        break;
    }
    case "_SURF_URI":
        await runEnhancedPrompt()
        break;
    case "_SURF_URI_BMARK": {
        const values = readBookmarks();
        const currentURL = await getProp("_SURF_URI");
        values.set("Current: " + currentURL, currentURL)
        const uri = await promptDmenu("URI:", "", values);
        await setProp("_SURF_GO", uri);
        break;
    }
    default:
        console.error("Invalid readProp: " + readProp);
}

database.close();
