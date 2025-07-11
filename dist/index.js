import dotenv from 'dotenv';
import { writeFile } from 'fs/promises';
import { resolve as resolvePath } from 'path';
import { URL } from 'url';
import { inspect } from 'util';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { DistributionStructure } from './structure/spec_model/Distribution.struct.js';
import { ServerStructure } from './structure/spec_model/Server.struct.js';
import { VersionSegmentedRegistry } from './util/VersionSegmentedRegistry.js';
import { VersionUtil } from './util/VersionUtil.js';
import { MinecraftVersion } from './util/MinecraftVersion.js';
import { LoggerUtil } from './util/LoggerUtil.js';
import { generateSchemas } from './util/SchemaUtil.js';
import { CurseForgeParser } from './parser/CurseForgeParser.js';
dotenv.config();
const logger = LoggerUtil.getLogger('Index');
function getRoot() {
    return resolvePath(process.env.ROOT);
}
function getHeliosDataFolder() {
    if (process.env.HELIOS_DATA_FOLDER) {
        return resolvePath(process.env.HELIOS_DATA_FOLDER);
    }
    return null;
}
function getBaseURL() {
    let baseUrl = process.env.BASE_URL;
    // Users must provide protocol in all other instances.
    if (!baseUrl.includes('//')) {
        if (baseUrl.toLowerCase().startsWith('localhost')) {
            baseUrl = 'http://' + baseUrl;
        }
        else {
            throw new TypeError('Please provide a URL protocol (ex. http:// or https://)');
        }
    }
    return (new URL(baseUrl)).toString();
}
function installLocalOption(yargs) {
    return yargs.option('installLocal', {
        describe: 'Install the generated distribution to your local Helios data folder.',
        type: 'boolean',
        demandOption: false,
        global: false,
        default: false
    });
}
function discardOutputOption(yargs) {
    return yargs.option('discardOutput', {
        describe: 'Delete cached output after it is no longer required. May be useful if disk space is limited.',
        type: 'boolean',
        demandOption: false,
        global: false,
        default: false
    });
}
function invalidateCacheOption(yargs) {
    return yargs.option('invalidateCache', {
        describe: 'Invalidate and delete existing caches as they are encountered. Requires fresh cache generation.',
        type: 'boolean',
        demandOption: false,
        global: false,
        default: false
    });
}
// function rootOption(yargs: Argv) {
//     return yargs.option('root', {
//         describe: 'File structure root.',
//         type: 'string',
//         demandOption: true,
//         global: true
//     })
//     .coerce({
//         root: resolvePath
//     })
// }
// function baseUrlOption(yargs: Argv) {
//     return yargs.option('baseUrl', {
//         describe: 'Base url of your file host.',
//         type: 'string',
//         demandOption: true,
//         global: true
//     })
//     .coerce({
//         baseUrl: (arg: string) => {
//             // Users must provide protocol in all other instances.
//             if (arg.indexOf('//') === -1) {
//                 if (arg.toLowerCase().startsWith('localhost')) {
//                     arg = 'http://' + arg
//                 } else {
//                     throw new TypeError('Please provide a URL protocol (ex. http:// or https://)')
//                 }
//             }
//             return (new URL(arg)).toString()
//         }
//     })
// }
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function namePositional(yargs) {
    return yargs.option('name', {
        describe: 'Distribution index file name.',
        type: 'string',
        default: 'distribution'
    });
}
// -------------
// Init Commands
const initRootCommand = {
    command: 'root',
    describe: 'Generate an empty standard file structure.',
    builder: (yargs) => {
        // yargs = rootOption(yargs)
        return yargs;
    },
    handler: async (argv) => {
        argv.root = getRoot();
        logger.debug(`Root set to ${argv.root}`);
        logger.debug('Invoked init root.');
        try {
            await generateSchemas(argv.root);
            await new DistributionStructure(argv.root, '', false, false).init();
            await new CurseForgeParser(argv.root, '').init();
            logger.info(`Successfully created new root at ${argv.root}`);
        }
        catch (error) {
            logger.error(`Failed to init new root at ${argv.root}`, error);
        }
    }
};
const initCommand = {
    command: 'init',
    aliases: ['i'],
    describe: 'Base init command.',
    builder: (yargs) => {
        return yargs
            .command(initRootCommand);
    },
    handler: (argv) => {
        argv._handled = true;
    }
};
// -----------------
// Generate Commands
const generateServerCommand = {
    command: 'server <id> <version>',
    describe: 'Generate a new server configuration.',
    builder: (yargs) => {
        // yargs = rootOption(yargs)
        return yargs
            .positional('id', {
            describe: 'Server id.',
            type: 'string'
        })
            .positional('version', {
            describe: 'Minecraft version.',
            type: 'string'
        })
            .option('forge', {
            describe: 'Forge version.',
            type: 'string'
        })
            .option('neoforge', {
            describe: 'NeoForge version.',
            type: 'string'
        })
            .option('fabric', {
            describe: 'Fabric version.',
            type: 'string'
        })
            .conflicts('forge', 'fabric');
    },
    handler: async (argv) => {
        argv.root = getRoot();
        logger.debug(`Root set to ${argv.root}`);
        logger.debug(`Generating server ${argv.id} for Minecraft ${argv.version}.`, `\n\t└ Forge version: ${argv.forge}`, `\n\t└ Fabric version: ${argv.fabric}`, `\n\t└ NeoForge version: ${argv.neoforge}`);
        const minecraftVersion = new MinecraftVersion(argv.version);
        if (argv.forge != null) {
            if (VersionUtil.isPromotionVersion(argv.forge)) {
                logger.debug(`Resolving ${argv.forge} Forge Version..`);
                const version = await VersionUtil.getPromotedForgeVersion(minecraftVersion, argv.forge);
                logger.debug(`Forge version set to ${version}`);
                argv.forge = version;
            }
            if (minecraftVersion.isGreaterThanOrEqualTo(new MinecraftVersion('1.20.3'))) {
                logger.error('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓');
                logger.error('┃                     !!  WARNING !!                      ┃');
                logger.error('┃                                                         ┃');
                logger.error('┃    Forge 1.20.3+ removed support for --fml.modLists.    ┃');
                logger.error('┃  Helios Launcher can no longer load mods through Forge. ┃');
                logger.error('┃             Please use Fabric or NeoForge.              ┃');
                logger.error('┃                                                         ┃');
                logger.error('┃                     !!  WARNING !!                      ┃');
                logger.error('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛');
            }
        }
        if (argv.neoforge != null) {
            if (VersionUtil.isPromotionVersion(argv.neoforge)) {
                logger.debug(`Resolving ${argv.neoforge} NeoForge Version..`);
                const version = await VersionUtil.getPromotedNeoForgeVersion(minecraftVersion, argv.neoforge);
                logger.debug(`NeoForge version set to ${version}`);
                argv.neoforge = version;
            }
        }
        if (argv.fabric != null) {
            if (VersionUtil.isPromotionVersion(argv.fabric)) {
                logger.debug(`Resolving ${argv.fabric} Fabric Version..`);
                const version = await VersionUtil.getPromotedFabricVersion(argv.fabric);
                logger.debug(`Fabric version set to ${version}`);
                argv.fabric = version;
            }
        }
        const serverStruct = new ServerStructure(argv.root, getBaseURL(), false, false);
        await serverStruct.createServer(argv.id, minecraftVersion, {
            forgeVersion: argv.forge,
            fabricVersion: argv.fabric,
            neoforgeVersion: argv.neoforge
        });
    }
};
const generateServerCurseForgeCommand = {
    command: 'server-curseforge <id> <zipName>',
    describe: 'Generate a new server configuration from a CurseForge modpack.',
    builder: (yargs) => {
        // yargs = rootOption(yargs)
        return yargs
            .positional('id', {
            describe: 'Server id.',
            type: 'string'
        })
            .positional('zipName', {
            describe: 'The name of the modpack zip file.',
            type: 'string'
        });
    },
    handler: async (argv) => {
        argv.root = getRoot();
        logger.debug(`Root set to ${argv.root}`);
        logger.debug(`Generating server ${argv.id} using CurseForge modpack ${argv.zipName} as a template.`);
        const parser = new CurseForgeParser(argv.root, argv.zipName);
        const modpackManifest = await parser.getModpackManifest();
        const minecraftVersion = new MinecraftVersion(modpackManifest.minecraft.version);
        // Extract forge version
        // TODO Support fabric
        const forgeModLoader = modpackManifest.minecraft.modLoaders.find(({ id }) => id.toLowerCase().startsWith('forge-'));
        const forgeVersion = forgeModLoader != null ? forgeModLoader.id.substring('forge-'.length) : undefined;
        const neoforgeModLoader = modpackManifest.minecraft.modLoaders.find(({ id }) => id.toLowerCase().startsWith('neoforge-'));
        const neoforgeVersion = neoforgeModLoader != null ? neoforgeModLoader.id.substring('neoforge-'.length) : undefined;
        if (forgeModLoader)
            logger.debug(`Forge version set to ${forgeVersion}`);
        if (neoforgeModLoader)
            logger.debug(`NeoForge version set to ${neoforgeVersion}`);
        const serverStruct = new ServerStructure(argv.root, getBaseURL(), false, false);
        const createServerResult = await serverStruct.createServer(argv.id, minecraftVersion, {
            version: modpackManifest.version,
            forgeVersion: forgeVersion,
            neoforgeVersion: neoforgeVersion
        });
        if (createServerResult) {
            await parser.enrichServer(createServerResult, modpackManifest);
        }
    }
};
const generateDistroCommand = {
    command: 'distro [name]',
    describe: 'Generate a distribution index from the root file structure.',
    builder: (yargs) => {
        yargs = installLocalOption(yargs);
        yargs = discardOutputOption(yargs);
        yargs = invalidateCacheOption(yargs);
        yargs = namePositional(yargs);
        return yargs;
    },
    handler: async (argv) => {
        argv.root = getRoot();
        argv.baseUrl = getBaseURL();
        const finalName = `${argv.name}.json`;
        logger.debug(`Root set to ${argv.root}`);
        logger.debug(`Base Url set to ${argv.baseUrl}`);
        logger.debug(`Install option set to ${argv.installLocal}`);
        logger.debug(`Discard Output option set to ${argv.discardOutput}`);
        logger.debug(`Invalidate Cache option set to ${argv.invalidateCache}`);
        logger.debug(`Invoked generate distro name ${finalName}.`);
        const doLocalInstall = argv.installLocal;
        const discardOutput = argv.discardOutput ?? false;
        const invalidateCache = argv.invalidateCache ?? false;
        const heliosDataFolder = getHeliosDataFolder();
        if (doLocalInstall && heliosDataFolder == null) {
            logger.error('You MUST specify HELIOS_DATA_FOLDER in your .env when using the --installLocal option.');
            return;
        }
        try {
            const distributionStruct = new DistributionStructure(argv.root, argv.baseUrl, discardOutput, invalidateCache);
            const distro = await distributionStruct.getSpecModel();
            const distroOut = JSON.stringify(distro, null, 2);
            const distroPath = resolvePath(argv.root, finalName);
            await writeFile(distroPath, distroOut);
            logger.info(`Successfully generated ${finalName}`);
            logger.info(`Saved to ${distroPath}`);
            logger.debug('Preview:\n', distro);
            if (doLocalInstall) {
                const finalDestination = resolvePath(heliosDataFolder, finalName);
                logger.info(`Installing distribution to ${finalDestination}`);
                await writeFile(finalDestination, distroOut);
                logger.info('Success!');
            }
        }
        catch (error) {
            logger.error(`Failed to generate distribution with root ${argv.root}.`, error);
        }
    }
};
const generateSchemasCommand = {
    command: 'schemas',
    describe: 'Generate json schemas.',
    handler: async (argv) => {
        argv.root = getRoot();
        logger.debug(`Root set to ${argv.root}`);
        logger.debug('Invoked generate schemas.');
        try {
            await generateSchemas(argv.root);
            logger.info('Successfully generated schemas');
        }
        catch (error) {
            logger.error(`Failed to generate schemas with root ${argv.root}.`, error);
        }
    }
};
const generateCommand = {
    command: 'generate',
    aliases: ['g'],
    describe: 'Base generate command.',
    builder: (yargs) => {
        return yargs
            .command(generateServerCurseForgeCommand)
            .command(generateServerCommand)
            .command(generateDistroCommand)
            .command(generateSchemasCommand);
    },
    handler: (argv) => {
        argv._handled = true;
    }
};
const validateCommand = {
    command: 'validate [name]',
    describe: 'Validate a distribution.json against the spec.',
    builder: (yargs) => {
        return namePositional(yargs);
    },
    handler: (argv) => {
        logger.debug(`Invoked validate with name ${argv.name}.json`);
    }
};
const latestForgeCommand = {
    command: 'latest-forge <version>',
    describe: 'Get the latest version of forge.',
    handler: async (argv) => {
        logger.debug(`Invoked latest-forge with version ${argv.version}.`);
        const minecraftVersion = new MinecraftVersion(argv.version);
        const forgeVer = await VersionUtil.getPromotedForgeVersion(minecraftVersion, 'latest');
        logger.info(`Latest version: Forge ${forgeVer} (${argv.version})`);
    }
};
const recommendedForgeCommand = {
    command: 'recommended-forge <version>',
    describe: 'Get the recommended version of forge. Returns latest if there is no recommended build.',
    handler: async (argv) => {
        logger.debug(`Invoked recommended-forge with version ${argv.version}.`);
        const index = await VersionUtil.getPromotionIndex();
        const minecraftVersion = new MinecraftVersion(argv.version);
        let forgeVer = VersionUtil.getPromotedVersionStrict(index, minecraftVersion, 'recommended');
        if (forgeVer != null) {
            logger.info(`Recommended version: Forge ${forgeVer} (${minecraftVersion})`);
        }
        else {
            logger.info(`No recommended build for ${minecraftVersion}. Checking for latest version..`);
            forgeVer = VersionUtil.getPromotedVersionStrict(index, minecraftVersion, 'latest');
            if (forgeVer != null) {
                logger.info(`Latest version: Forge ${forgeVer} (${minecraftVersion})`);
            }
            else {
                logger.info(`No build available for ${minecraftVersion}.`);
            }
        }
    }
};
const testCommand = {
    command: 'test <mcVer> <forgeVer>',
    describe: 'Validate a distribution.json against the spec.',
    builder: (yargs) => {
        return namePositional(yargs);
    },
    handler: async (argv) => {
        logger.debug(`Invoked test with mcVer ${argv.mcVer} forgeVer ${argv.forgeVer}`);
        logger.info(process.cwd());
        const mcVer = new MinecraftVersion(argv.mcVer);
        const resolver = VersionSegmentedRegistry.getForgeResolver(mcVer, argv.forgeVer, getRoot(), '', getBaseURL(), false, false);
        if (resolver != null) {
            const mdl = await resolver.getModule();
            logger.info(inspect(mdl, false, null, true));
        }
    }
};
// Registering yargs configuration.
await yargs(hideBin(process.argv))
    .version(false)
    .scriptName('')
    .command(initCommand)
    .command(generateCommand)
    .command(validateCommand)
    .command(latestForgeCommand)
    .command(recommendedForgeCommand)
    .command(testCommand)
    .demandCommand()
    .help()
    .argv;
//# sourceMappingURL=index.js.map