/**
 * Worker entry.
 *
 * Worker threads do not accept `--import` in `execArgv`, so the tsx loader is
 * registered from inside the thread instead, then the TypeScript worker module
 * is imported dynamically. Plain .mjs so Node can load it without a loader.
 */
import { register } from "tsx/esm/api";

register();
await import("./episodeWorker.ts");
