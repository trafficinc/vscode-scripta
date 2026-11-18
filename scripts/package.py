"""Build a local-install VSIX using only Python's standard library."""
import json
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
package = json.loads((root / 'package.json').read_text())
name, version = package['name'], package['version']
output = root / 'dist' / f'{name}-{version}.vsix'
output.parent.mkdir(exist_ok=True)
manifest = f'''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
 <Metadata>
  <Identity Language="en-US" Id="{name}" Version="{version}" Publisher="{package['publisher']}"/>
  <DisplayName>{escape(package['displayName'])}</DisplayName>
  <Description xml:space="preserve">{escape(package['description'])}</Description>
  <Tags>scripta,scta,scr</Tags><Categories>Programming Languages,Snippets</Categories>
  <Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="{package['engines']['vscode']}"/></Properties>
  <License>extension/LICENSE</License>
 </Metadata>
 <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
 <Dependencies/>
 <Assets>
  <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
  <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/>
  <Asset Type="Microsoft.VisualStudio.Services.Content.Changelog" Path="extension/CHANGELOG.md" Addressable="true"/>
  <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true"/>
 </Assets>
</PackageManifest>'''
content_types = '''<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="js" ContentType="application/javascript"/>
 <Default Extension="json" ContentType="application/json"/>
 <Default Extension="scripta" ContentType="text/plain"/>
 <Default Extension="scta" ContentType="text/plain"/>
 <Default Extension="md" ContentType="text/markdown"/>
 <Default Extension="svg" ContentType="image/svg+xml"/>
 <Default Extension="png" ContentType="image/png"/>
 <Default Extension="vsixmanifest" ContentType="text/xml"/>
 <Override PartName="/extension/LICENSE" ContentType="text/plain"/>
</Types>'''
files = ['package.json', 'language-configuration.json', 'README.md', 'CHANGELOG.md', 'LICENSE']
files += [str(p.relative_to(root)) for d in ['syntaxes', 'snippets', 'examples', 'src', 'assets'] for p in sorted((root / d).rglob('*')) if p.is_file()]
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    archive.writestr('[Content_Types].xml', content_types)
    archive.writestr('extension.vsixmanifest', manifest)
    for file in files:
        archive.write(root / file, 'extension/' + file)
print(output)
