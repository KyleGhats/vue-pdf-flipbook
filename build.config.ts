import { copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
  entries: ["src/index"],
  declaration: true,
  clean: true,
  rollup: {
    emitCJS: true,
  },
  externals: ["vue", "three", "turngl", "pdfjs-dist"],
  hooks: {
    "build:done"() {
      copyFileSync(
        resolve("node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
        resolve("dist/pdf.worker.min.mjs"),
      );
    },
  },
});
