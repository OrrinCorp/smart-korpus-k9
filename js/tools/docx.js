/* Мінімальний генератор .docx (OOXML + ZIP без стиснення) без зовнішніх бібліотек.
 * API: var d = SK.docx.doc(); d.h1('…'); d.p('…'); d.table(['A','B'], [['1','2']], [30,70]);
 *      var bytes = d.build({ title, author });  // Uint8Array — вміст файлу .docx */
SK.docx = (function () {
  /* ---------- ZIP (метод store) ---------- */
  var CRC = (function () { var t = [], c; for (var n = 0; n < 256; n++) { c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xffffffff; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function utf8(s) { return new TextEncoder().encode(s); }
  function zip(files) {             // files: [{name, data: Uint8Array}]
    var parts = [], central = [], off = 0;
    function u16(v) { return [v & 255, (v >>> 8) & 255]; }
    function u32(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
    files.forEach(function (f) {
      var name = utf8(f.name), crc = crc32(f.data), sz = f.data.length;
      var lh = [].concat([0x50, 0x4b, 3, 4], u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(sz), u32(sz), u16(name.length), u16(0));
      parts.push(new Uint8Array(lh), name, f.data);
      central.push({ h: [].concat([0x50, 0x4b, 1, 2], u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(sz), u32(sz),
        u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off)), name: name });
      off += lh.length + name.length + sz;
    });
    var cdStart = off, cdSize = 0;
    central.forEach(function (c) { parts.push(new Uint8Array(c.h), c.name); cdSize += c.h.length + c.name.length; });
    parts.push(new Uint8Array([].concat([0x50, 0x4b, 5, 6], u16(0), u16(0), u16(central.length), u16(central.length), u32(cdSize), u32(cdStart), u16(0))));
    var total = parts.reduce(function (a, p) { return a + p.length; }, 0), out = new Uint8Array(total), pos = 0;
    parts.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  /* ---------- OOXML ---------- */
  function x(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function run(t, o) {
    o = o || {};
    var pr = (o.b ? '<w:b/>' : '') + (o.i ? '<w:i/>' : '') + (o.color ? '<w:color w:val="' + o.color + '"/>' : '') + (o.sz ? '<w:sz w:val="' + o.sz + '"/><w:szCs w:val="' + o.sz + '"/>' : '');
    return '<w:r>' + (pr ? '<w:rPr>' + pr + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + x(t) + '</w:t></w:r>';
  }
  /* Текст із **жирним** фрагментом */
  function runs(t, o) {
    return String(t).split(/(\*\*[^*]+\*\*)/).map(function (s) {
      if (/^\*\*.*\*\*$/.test(s)) { var oo = {}; for (var k in (o || {})) oo[k] = o[k]; oo.b = true; return run(s.slice(2, -2), oo); }
      return s ? run(s, o) : '';
    }).join('');
  }
  function para(content, style, extra) {
    return '<w:p>' + (style || extra ? '<w:pPr>' + (style ? '<w:pStyle w:val="' + style + '"/>' : '') + (extra || '') + '</w:pPr>' : '') + content + '</w:p>';
  }

  function doc() {
    var body = [];
    var api = {
      title: function (t, sub) { body.push(para(runs(t), 'Title')); if (sub) body.push(para(runs(sub), 'Subtitle')); return api; },
      h1: function (t) { body.push(para(runs(t), 'Heading1')); return api; },
      h2: function (t) { body.push(para(runs(t), 'Heading2')); return api; },
      h3: function (t) { body.push(para(runs(t), 'Heading3')); return api; },
      p: function (t, o) { body.push(para(runs(t, o))); return api; },
      note: function (t) { body.push(para(runs(t), 'Note')); return api; },
      bullets: function (items) { items.forEach(function (t) { body.push(para(runs(t), 'ListBullet')); }); return api; },
      pageBreak: function () { body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>'); return api; },
      /* Таблиця: widths — частки ширини у відсотках */
      table: function (head, rows, widths) {
        var W = 9638, cols = head.length;
        widths = widths || head.map(function () { return 100 / cols; });
        var tw = widths.map(function (w) { return Math.round(W * w / 100); });
        var grid = '<w:tblGrid>' + tw.map(function (w) { return '<w:gridCol w:w="' + w + '"/>'; }).join('') + '</w:tblGrid>';
        function cell(t, i, hdr) {
          return '<w:tc><w:tcPr><w:tcW w:w="' + tw[i] + '" w:type="dxa"/>' + (hdr ? '<w:shd w:val="clear" w:color="auto" w:fill="DCE6F0"/>' : '') + '</w:tcPr>' +
            String(t == null ? '' : t).split('\n').map(function (line) { return para(runs(line, hdr ? { b: true } : null), 'TableText'); }).join('') + '</w:tc>';
        }
        var h = '<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>' + head.map(function (t, i) { return cell(t, i, true); }).join('') + '</w:tr>';
        var r = rows.map(function (row) { return '<w:tr><w:trPr><w:cantSplit/></w:trPr>' + row.map(function (t, i) { return cell(t, i, false); }).join('') + '</w:tr>'; }).join('');
        body.push('<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/><w:tblW w:w="' + W + '" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>' + grid + h + r + '</w:tbl>');
        body.push(para('', 'Spacer'));
        return api;
      },
      build: function (meta) {
        meta = meta || {};
        var NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
        var sect = '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/>' +
          '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>';
        var document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + NS + '><w:body>' + body.join('') + sect + '</w:body></w:document>';
        var footer = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ' + NS + '>' +
          para(run((meta.footer || '') + ' · с. ', { sz: 16, color: '666666' }) + '<w:r><w:rPr><w:sz w:val="16"/><w:color w:val="666666"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>' +
            '<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>', null, '<w:jc w:val="right"/>') + '</w:ftr>';
        var font = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/>';
        function st(id, name, rpr, ppr, extra) {
          return '<w:style w:type="paragraph" w:styleId="' + id + '"><w:name w:val="' + name + '"/><w:basedOn w:val="Normal"/>' + (extra || '') +
            '<w:pPr>' + (ppr || '') + '</w:pPr><w:rPr>' + (rpr || '') + '</w:rPr></w:style>';
        }
        var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
          '<w:docDefaults><w:rPrDefault><w:rPr>' + font + '<w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="uk-UA"/></w:rPr></w:rPrDefault>' +
          '<w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
          '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
          st('Title', 'Title', '<w:b/><w:sz w:val="40"/><w:color w:val="1F4E79"/>', '<w:spacing w:before="1600" w:after="200"/>') +
          st('Subtitle', 'Subtitle', '<w:sz w:val="24"/><w:color w:val="4B5B66"/>', '<w:spacing w:after="120"/>') +
          st('Heading1', 'heading 1', '<w:b/><w:sz w:val="30"/><w:color w:val="1F4E79"/>', '<w:keepNext/><w:spacing w:before="360" w:after="140"/><w:outlineLvl w:val="0"/>', '<w:qFormat/>') +
          st('Heading2', 'heading 2', '<w:b/><w:sz w:val="24"/><w:color w:val="1F4E79"/>', '<w:keepNext/><w:spacing w:before="240" w:after="100"/><w:outlineLvl w:val="1"/>', '<w:qFormat/>') +
          st('Heading3', 'heading 3', '<w:b/><w:sz w:val="21"/><w:color w:val="333333"/>', '<w:keepNext/><w:spacing w:before="180" w:after="80"/><w:outlineLvl w:val="2"/>', '<w:qFormat/>') +
          st('TableText', 'Table Text', '<w:sz w:val="16"/><w:szCs w:val="16"/>', '<w:spacing w:before="20" w:after="20" w:line="240" w:lineRule="auto"/>') +
          st('Note', 'Note', '<w:i/><w:sz w:val="18"/><w:color w:val="4B5B66"/>', '<w:pBdr><w:left w:val="single" w:sz="18" w:space="6" w:color="1F6FB2"/></w:pBdr><w:ind w:left="200"/><w:spacing w:before="80" w:after="140"/>') +
          st('ListBullet', 'List Bullet', '', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:ind w:left="400" w:hanging="260"/><w:spacing w:after="60"/>') +
          st('Spacer', 'Spacer', '<w:sz w:val="8"/>', '<w:spacing w:after="80"/>') +
          '<w:style w:type="table" w:styleId="Grid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>' +
          ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (b) { return '<w:' + b + ' w:val="single" w:sz="4" w:space="0" w:color="B8C4CC"/>'; }).join('') +
          '</w:tblBorders><w:tblCellMar><w:left w:w="70" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>';
        var numbering = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
          '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/>' +
          '<w:pPr><w:ind w:left="400" w:hanging="260"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';
        var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
          '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
          '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
          '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';
        var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>';
        var drels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          '<Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
          '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>';
        var now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
        var core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
          'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
          '<dc:title>' + x(meta.title || '') + '</dc:title><dc:creator>' + x(meta.author || '') + '</dc:creator><dc:language>uk-UA</dc:language>' +
          '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created></cp:coreProperties>';
        return zip([
          { name: '[Content_Types].xml', data: utf8(ct) }, { name: '_rels/.rels', data: utf8(rels) },
          { name: 'word/document.xml', data: utf8(document) }, { name: 'word/_rels/document.xml.rels', data: utf8(drels) },
          { name: 'word/styles.xml', data: utf8(styles) }, { name: 'word/numbering.xml', data: utf8(numbering) },
          { name: 'word/footer1.xml', data: utf8(footer) }, { name: 'docProps/core.xml', data: utf8(core) }
        ]);
      }
    };
    return api;
  }
  function download(bytes, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  return { doc: doc, download: download };
})();
