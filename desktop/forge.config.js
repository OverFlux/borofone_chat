const path = require("node:path");

module.exports = {
  packagerConfig: {
    asar: true,
    extraResource: [path.resolve(__dirname, "..", "favicon.ico")],
    ignore: [/^\/tests(?:\/|$)/, /^\/out(?:\/|$)/],
    icon: path.resolve(__dirname, "..", "favicon"),
    executableName: "Borotalk",
    win32metadata: {
      CompanyName: "Borotalk",
      FileDescription: "Borotalk Desktop",
      ProductName: "Borotalk Desktop",
      InternalName: "Borotalk",
    },
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "borotalk_desktop",
        setupIcon: path.resolve(__dirname, "..", "favicon.ico"),
        noMsi: true,
      },
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["win32"],
    },
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-auto-unpack-natives",
      config: {},
    },
  ],
};
