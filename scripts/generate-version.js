const fs = require('fs');
const path = require('path');

const packageJson = require('../package.json');

const projectInfo = {
  name: packageJson.name,
  version: packageJson.version,
  buildDate: new Date().toISOString(),
  homepage: packageJson.homepage,
  repository: packageJson.repository.url,
  issues: packageJson.bugs.url,
  description: packageJson.description,
  keywords: packageJson.keywords,

  // custom fields
  displayName: packageJson.displayName || packageJson.name,
  tagline: packageJson.tagline,
};

const versionFilePath = path.join(__dirname, '../src/app/version.ts');
const fileContent = `// Auto-generated file
export const VERSION = ${JSON.stringify(projectInfo, null, 2)};
`;

fs.writeFileSync(versionFilePath, fileContent);
console.log('Version file generated successfully!');