import { mkdirs, pathExists } from 'fs-extra/esm';
import { lstat, readdir, readFile, writeFile } from 'fs/promises';
import { dirname, join, resolve as resolvePath } from 'path';
import { URL } from 'url';
import { VersionSegmentedRegistry } from '../../util/VersionSegmentedRegistry.js';
import { getDefaultServerMeta } from '../../model/nebula/ServerMeta.js';
import { BaseModelStructure } from './BaseModel.struct.js';
import { FabricModStructure } from './module/FabricMod.struct.js';
import { MiscFileStructure } from './module/File.struct.js';
import { LibraryStructure } from './module/Library.struct.js';
import { MinecraftVersion } from '../../util/MinecraftVersion.js';
import { addSchemaToObject, SchemaTypes } from '../../util/SchemaUtil.js';
import { isValidUrl } from '../../util/StringUtils.js';
import { FabricResolver } from '../../resolver/fabric/Fabric.resolver.js';
import { NeoForgeModStructure } from './module/NeoForgeMod.struct.js';
import { NeoForgeResolver } from '../../resolver/neoforge/NeoForge.resolver.js';
export class ServerStructure extends BaseModelStructure {
    discardOutput;
    invalidateCache;
    ID_REGEX = /(.+-(.+)$)/;
    SERVER_META_FILE = 'servermeta.json';
    constructor(absoluteRoot, baseUrl, discardOutput, invalidateCache) {
        super(absoluteRoot, '', 'servers', baseUrl);
        this.discardOutput = discardOutput;
        this.invalidateCache = invalidateCache;
    }
    getLoggerName() {
        return 'ServerStructure';
    }
    async getSpecModel() {
        if (this.resolvedModels == null) {
            this.resolvedModels = await this._doSeverRetrieval();
        }
        return this.resolvedModels;
    }
    static getEffectiveId(id, minecraftVersion) {
        return `${id}-${minecraftVersion}`;
    }
    async createServer(id, minecraftVersion, options) {
        const effectiveId = ServerStructure.getEffectiveId(id, minecraftVersion);
        const absoluteServerRoot = resolvePath(this.containerDirectory, effectiveId);
        const relativeServerRoot = join(this.relativeRoot, effectiveId);
        if (await pathExists(absoluteServerRoot)) {
            this.logger.error('Server already exists! Aborting.');
            return null;
        }
        await mkdirs(absoluteServerRoot);
        const serverMetaOpts = {
            version: options.version
        };
        let modContainer = undefined;
        if (options.forgeVersion != null) {
            const fms = VersionSegmentedRegistry.getForgeModStruct(minecraftVersion, options.forgeVersion, absoluteServerRoot, relativeServerRoot, this.baseUrl, []);
            await fms.init();
            modContainer = fms.getContainerDirectory();
            serverMetaOpts.forgeVersion = options.forgeVersion;
        }
        if (options.fabricVersion != null) {
            const fms = new FabricModStructure(absoluteServerRoot, relativeServerRoot, this.baseUrl, minecraftVersion, []);
            await fms.init();
            modContainer = fms.getContainerDirectory();
            serverMetaOpts.fabricVersion = options.fabricVersion;
        }
        if (options.neoforgeVersion != null) {
            const nfms = new NeoForgeModStructure(absoluteServerRoot, relativeServerRoot, this.baseUrl, minecraftVersion, []);
            await nfms.init();
            modContainer = nfms.getContainerDirectory();
            serverMetaOpts.neoforgeVersion = options.neoforgeVersion;
        }
        const serverMeta = addSchemaToObject(getDefaultServerMeta(id, minecraftVersion.toString(), serverMetaOpts), SchemaTypes.ServerMetaSchema, this.absoluteRoot);
        await writeFile(resolvePath(absoluteServerRoot, this.SERVER_META_FILE), JSON.stringify(serverMeta, null, 2));
        const libS = new LibraryStructure(absoluteServerRoot, relativeServerRoot, this.baseUrl, minecraftVersion, []);
        await libS.init();
        const mfs = new MiscFileStructure(absoluteServerRoot, relativeServerRoot, this.baseUrl, minecraftVersion, []);
        await mfs.init();
        return {
            modContainer,
            libraryContainer: libS.getContainerDirectory(),
            miscFileContainer: mfs.getContainerDirectory()
        };
    }
    async _doSeverRetrieval() {
        const accumulator = [];
        const files = await readdir(this.containerDirectory);
        for (const file of files) {
            const absoluteServerRoot = resolvePath(this.containerDirectory, file);
            const relativeServerRoot = join(this.relativeRoot, file);
            if ((await lstat(absoluteServerRoot)).isDirectory()) {
                this.logger.info(`Beginning processing of ${file}.`);
                const match = this.ID_REGEX.exec(file);
                if (match == null) {
                    this.logger.warn(`Server directory ${file} does not match the defined standard.`);
                    this.logger.warn('All server ids must end with -<minecraft version> (ex. -1.12.2)');
                    continue;
                }
                // Read server meta
                const serverMeta = JSON.parse(await readFile(resolvePath(absoluteServerRoot, this.SERVER_META_FILE), 'utf-8'));
                const minecraftVersion = new MinecraftVersion(match[2]);
                const untrackedFiles = serverMeta.untrackedFiles || [];
                let iconUrl = null;
                // Resolve server icon
                if (serverMeta.meta.icon && isValidUrl(serverMeta.meta.icon)) {
                    // Use the url they gave us.
                    iconUrl = serverMeta.meta.icon;
                }
                else {
                    this.logger.info('Server icon is either not set or not a valid URL.');
                    this.logger.info(`Looking for an icon file at ${absoluteServerRoot}`);
                    const subFiles = await readdir(absoluteServerRoot);
                    for (const subFile of subFiles) {
                        const caseInsensitive = subFile.toLowerCase();
                        if (caseInsensitive.endsWith('.jpg') || caseInsensitive.endsWith('.png')) {
                            iconUrl = new URL(join(relativeServerRoot, subFile), this.baseUrl).toString();
                        }
                    }
                    if (!iconUrl) {
                        this.logger.warn(`No icon file found for server ${file}.`);
                    }
                }
                const modules = [];
                if (serverMeta.forge) {
                    const forgeResolver = VersionSegmentedRegistry.getForgeResolver(minecraftVersion, serverMeta.forge.version, dirname(this.containerDirectory), '', this.baseUrl, this.discardOutput, this.invalidateCache);
                    // Resolve forge
                    const forgeItselfModule = await forgeResolver.getModule();
                    modules.push(forgeItselfModule);
                    const forgeModStruct = VersionSegmentedRegistry.getForgeModStruct(minecraftVersion, serverMeta.forge.version, absoluteServerRoot, relativeServerRoot, this.baseUrl, untrackedFiles);
                    const forgeModModules = await forgeModStruct.getSpecModel();
                    modules.push(...forgeModModules);
                }
                if (serverMeta.fabric) {
                    const fabricResolver = new FabricResolver(dirname(this.containerDirectory), '', this.baseUrl, serverMeta.fabric.version, minecraftVersion);
                    if (!fabricResolver.isForVersion(minecraftVersion, serverMeta.fabric.version)) {
                        throw new Error(`Fabric resolver does not support Fabric ${serverMeta.fabric.version}!`);
                    }
                    const fabricModule = await fabricResolver.getModule();
                    modules.push(fabricModule);
                    const fabricModStruct = new FabricModStructure(absoluteServerRoot, relativeServerRoot, this.baseUrl, minecraftVersion, untrackedFiles);
                    const fabricModModules = await fabricModStruct.getSpecModel();
                    modules.push(...fabricModModules);
                }
                if (serverMeta.neoforge) {
                    const neoforgeResolver = new NeoForgeResolver(dirname(this.containerDirectory), '', this.baseUrl, minecraftVersion, serverMeta.neoforge.version, this.discardOutput, this.invalidateCache);
                    const neoForgeModule = await neoforgeResolver.getModule();
                    modules.push(neoForgeModule);
                    const neoforgeModStruct = new NeoForgeModStructure(absoluteServerRoot, relativeServerRoot, this.baseUrl, minecraftVersion, untrackedFiles);
                    const neoforgeModModules = await neoforgeModStruct.getSpecModel();
                    modules.push(...neoforgeModModules);
                }
                const libraryStruct = new LibraryStructure(absoluteServerRoot, relativeServerRoot, this.baseUrl, minecraftVersion, untrackedFiles);
                const libraryModules = await libraryStruct.getSpecModel();
                modules.push(...libraryModules);
                const fileStruct = new MiscFileStructure(absoluteServerRoot, relativeServerRoot, this.baseUrl, minecraftVersion, untrackedFiles);
                const fileModules = await fileStruct.getSpecModel();
                modules.push(...fileModules);
                accumulator.push({
                    id: match[1],
                    name: serverMeta.meta.name,
                    description: serverMeta.meta.description,
                    icon: iconUrl,
                    version: serverMeta.meta.version,
                    address: serverMeta.meta.address,
                    minecraftVersion: match[2],
                    ...(serverMeta.meta.discord ? { discord: serverMeta.meta.discord } : {}),
                    mainServer: serverMeta.meta.mainServer,
                    autoconnect: serverMeta.meta.autoconnect,
                    javaOptions: serverMeta.meta.javaOptions,
                    modules
                });
            }
            else {
                this.logger.warn(`Path ${file} in server directory is not a directory!`);
            }
        }
        return accumulator;
    }
}
//# sourceMappingURL=Server.struct.js.map