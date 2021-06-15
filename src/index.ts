/* eslint-disable @typescript-eslint/no-var-requires */

/*
 ! This script creates a fig command spec completion file based on a man page. only parses flags, not templates because its impossible.
 ! Manual created fig command spec completion files should be used over the generated ones by this script.
 */

// Dependencies
import fs from "fs";
import { sleep } from "sleep";
import execSh from "exec-sh";
import { parse } from "node-html-parser";
import pretty from "pretty";
import manolo from "manolo";
import removeTrailingSpaces from "remove-trailing-spaces";

async function getFigCompletionObjectFromManPageOfACommand(
  cmd: string
): Promise<unknown> {
  // Check command was provided
  if (cmd == undefined) {
    console.log("Usage: `./generate.sh YOUR_COMMAND`");
    process.exit(1);
  }

  // Wait until we get the parsed man page
  const manPage = await new Promise((resolve) => {
    // man -w MAN_PAGE gives us the path to it
    execSh(
      `/usr/bin/man -w ${cmd}`,
      true,
      async (err: never, stdout: string, stderr: string) => {
        // initialize parsed-man-page's variable
        let manPageInHTML = "";
        // Check if page exists
        if (err || stderr.length > 0) {
          console.log(`No MAN page found for \`${cmd}\``);
          process.exit(1);
        }
        // remove trailing newlines
        const manPage = stdout.split("\n")[0];
        // check if man is compressed. currently only supports gzip compression
        if (isCompressed(manPage)) {
          // save decompressed man page in /tmp
          const decompressManPage = async (path: string): Promise<string> => {
            await execSh(`gzip -dc7 ${path} > /tmp/${cmd}.1`);
            // Fixes a bug that happens because saved decompressed man page is accessed before being written
            sleep(1);
            return `/tmp/${cmd}.1`;
          };
          // wait until the man page is parsed & resolve it
          await new Promise((resolve) => {
            decompressManPage(manPage).then(async (decompressedManPagePath) => {
              const man = await fs.promises.readFile(
                decompressedManPagePath,
                "utf8"
              );
              manPageInHTML = manolo(man).toHTML();
              resolve(manPageInHTML);
            });
          });
        } else {
          // wait until the man page is parsed & resolve it
          await new Promise(async (resolve) => {
            const man = await fs.promises.readFile(manPage, "utf8");
            manPageInHTML = manolo(man).toHTML();
            resolve(manPageInHTML);
          });
        }
        // resolve parsed man page
        resolve(manPageInHTML);
      }
    );
  }).then((manPageInHTML) => {
    // format man page
    return pretty(manPageInHTML);
  });
  // get options
  const options = manPage
    .substring(manPage.search("<dl>"), manPage.search("</dl>")) // dl are the tags used by flags
    .split("\n");
  // prepare vars
  const flags = {};
  let count = 0;

  // map options
  for (let i = 0; i != options.length; i++) {
    await new Promise((resolve, reject) => {
      // initialize vars
      let flag = "";
      let description = "";

      // get options
      flag = options[i].match(/(-{1,2})([a-zA-Z\-]*)/g);
      // avoid errors
      if (flag == null || (i / 2) % 1 == 0) reject();
      // parse description, it is next-to its flag, so we access the next line
      const desc = parse(options[i + 1]);
      description = desc.text;

      // resolve all
      resolve([flag, description.slice(2)]);
    })
      .then((entry) => {
        // set flags with their descriptions
        flags[`${count}`] = [entry[0], removeTrailingSpaces(entry[1])];
        count++;
      })
      // catch errors
      .catch((_) => {
        _ = "";
      });
    continue;
  }
  // init base completion spec
  const figCompletionSpec = {
    name: cmd,
    description: "", // TODO: Implement that
    options: [{}],
  };

  // insert options
  Object.keys(flags).forEach((k: string) => {
    figCompletionSpec.options.push({
      name: flags[k][0],
      description: flags[k][1],
    });
  });
  figCompletionSpec.options.shift(); // remove initializer object

  // return command autocomplete spec
  return figCompletionSpec;
}

// little function for checking if man pages are compressed
function isCompressed(manPage: string) {
  return manPage.endsWith(".gz");
}

// execute
let cmd = process.argv[2];
getFigCompletionObjectFromManPageOfACommand(cmd).then((figCompletionSpec) => {
  // prepare file
  const file = `export const completionSpec: Fig.Spec = 
${JSON.stringify(figCompletionSpec)}
`;
  // write file
  fs.writeFileSync(`./${cmd}.ts`, file, "utf8");
  console.log(
    `Now you just have to move the file ./${cmd}.ts to the \`dev\` folder on Fig's autocomplete source directory`
  );
});
