// LZEXE LZ91 Decompressor
// Ported from Python: github.com/samrussell/unpacklzexe

export function parseHeader(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    signature: String.fromCharCode(data[0], data[1]),
    partpage: view.getUint16(2, true),
    pagecnt: view.getUint16(4, true),
    relocnt: view.getUint16(6, true),
    hdrsize: view.getUint16(8, true),
    minalloc: view.getUint16(10, true),
    maxalloc: view.getUint16(12, true),
    initss: view.getUint16(14, true),
    initsp: view.getUint16(16, true),
    chksum: view.getUint16(18, true),
    initip: view.getUint16(20, true),
    initcs: view.getUint16(22, true),
    tabloff: view.getUint16(24, true),
    overlayno: view.getUint16(26, true),
  };
}

function generateHeader(h) {
  const buf = new Uint8Array(28);
  const view = new DataView(buf.buffer);
  buf[0] = h.signature.charCodeAt(0);
  buf[1] = h.signature.charCodeAt(1);
  view.setUint16(2, h.partpage, true);
  view.setUint16(4, h.pagecnt, true);
  view.setUint16(6, h.relocnt, true);
  view.setUint16(8, h.hdrsize, true);
  view.setUint16(10, h.minalloc, true);
  view.setUint16(12, h.maxalloc, true);
  view.setUint16(14, h.initss, true);
  view.setUint16(16, h.initsp, true);
  view.setUint16(18, h.chksum, true);
  view.setUint16(20, h.initip, true);
  view.setUint16(22, h.initcs, true);
  view.setUint16(24, h.tabloff, true);
  view.setUint16(26, h.overlayno, true);
  return buf;
}

export function checkSignatureLZ91(data) {
  const sig = String.fromCharCode(data[0x1C], data[0x1D], data[0x1E], data[0x1F]);
  return sig === 'LZ91';
}

function unpackLZ91Data(indata) {
  const out = [];
  let si = 0;
  let dx = 0x10;

  const readU16 = () => {
    const v = indata[si] | (indata[si + 1] << 8);
    si += 2;
    return v;
  };

  const readU8 = () => indata[si++];

  let bp = readU16();

  const getBit = () => {
    const bit = bp & 1;
    bp = bp >>> 1;
    dx--;
    if (dx === 0) {
      bp = readU16();
      dx = 0x10;
    }
    return bit;
  };

  while (true) {
    if (getBit() === 1) {
      // Literal byte
      out.push(indata[si]);
      si++;
      continue;
    }

    let cx = 0;

    if (getBit() === 0) {
      // Short back-reference
      cx = ((cx << 1) + getBit()) & 0xFFFF;
      cx = ((cx << 1) + getBit()) & 0xFFFF;
      cx += 2;
      const tempbyte = readU8();
      let bx = tempbyte - 0x100; // negative offset
      for (let i = 0; i < cx; i++) {
        out.push(out[out.length + bx]);
      }
      continue;
    }

    // Long back-reference
    const ax = readU16();
    let bx = ax;
    let bh = (bx >>> 8) >>> 3;
    bx = (bh << 8) | (bx & 0xFF);
    bx = bx - 0x2000; // negative offset
    const ah = (ax >>> 8) & 0x7;

    if (ah !== 0) {
      cx = ah + 2;
      for (let i = 0; i < cx; i++) {
        out.push(out[out.length + bx]);
      }
      continue;
    }

    const al = readU8();
    if (al === 0) {
      break; // End of data
    }
    if (al !== 1) {
      cx = al + 1;
      for (let i = 0; i < cx; i++) {
        out.push(out[out.length + bx]);
      }
      continue;
    }
    // al === 1: segment boundary signal, skip in flat model
  }

  return new Uint8Array(out);
}

function unpackLZ91Reloc(relocdata) {
  const relocout = [];
  let si = 0;
  let dx = 0;
  let di = 0;

  while (true) {
    let span = relocdata[si++];
    if (span === 0) {
      const ax = relocdata[si] | (relocdata[si + 1] << 8);
      si += 2;
      if (ax === 0) {
        dx = (dx + 0xFFF) & 0xFFFF;
        continue;
      }
      if (ax === 1) {
        break;
      }
      span = ax; // word value is the delta when byte was 0 and word > 1
    }
    di = di + span;
    let axFinal = di;
    di = di & 0xF;
    axFinal = axFinal >>> 4;
    dx = (dx + axFinal) & 0xFFFF;
    // Pack relocation entry (offset, segment)
    relocout.push(di & 0xFF);
    relocout.push((di >>> 8) & 0xFF);
    relocout.push(dx & 0xFF);
    relocout.push((dx >>> 8) & 0xFF);
  }

  return new Uint8Array(relocout);
}

export function unpackLZEXE(data) {
  if (!checkSignatureLZ91(data)) {
    throw new Error('Not a valid LZ91 file');
  }

  const headerdata = parseHeader(data);
  const headersize = headerdata.hdrsize * 0x10;
  const loadercs = headerdata.initcs;
  const loaderoffset = loadercs * 0x10 + headersize;

  // Read original entry point from loader stub
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const exeip = view.getUint16(loaderoffset + 0x00, true);
  const execs = view.getUint16(loaderoffset + 0x02, true);
  const exesp = view.getUint16(loaderoffset + 0x04, true);
  const exess = view.getUint16(loaderoffset + 0x06, true);

  // Extract packed data and relocation table
  const packeddata = data.slice(0x20, loaderoffset);
  const packedreloc = data.slice(loaderoffset + 0x158);

  // Decompress
  const unpackeddata = unpackLZ91Data(packeddata);
  const unpackedreloc = unpackLZ91Reloc(packedreloc);

  // Rebuild header
  const newHeader = { ...headerdata };
  newHeader.relocnt = Math.floor(unpackedreloc.length / 4);

  let newHeaderSize = newHeader.relocnt * 4 + 0x1C;
  const extra = newHeaderSize % 0x10;
  let padbytes = 0;
  if (extra > 0) {
    padbytes = 0x10 - extra;
  }
  newHeaderSize += padbytes;

  newHeader.hdrsize = Math.floor(newHeaderSize / 0x10);

  const filesize = newHeaderSize + unpackeddata.length;
  newHeader.partpage = filesize % 0x200;
  newHeader.pagecnt = Math.floor(filesize / 0x200);
  if (newHeader.partpage > 0) {
    newHeader.pagecnt++;
  }

  const lessmemory = unpackeddata.length - packeddata.length;
  newHeader.minalloc = Math.max(0, newHeader.minalloc - Math.floor(lessmemory / 0x10));
  newHeader.maxalloc = 0xFFFF;
  newHeader.chksum = 0;
  newHeader.initss = exess;
  newHeader.initsp = exesp;
  newHeader.initip = exeip;
  newHeader.initcs = execs;
  newHeader.tabloff = 0x1C;
  newHeader.overlayno = 0;

  // Assemble output
  const headerBytes = generateHeader(newHeader);
  const padding = new Uint8Array(padbytes);

  const output = new Uint8Array(headerBytes.length + unpackedreloc.length + padding.length + unpackeddata.length);
  let offset = 0;
  output.set(headerBytes, offset); offset += headerBytes.length;
  output.set(unpackedreloc, offset); offset += unpackedreloc.length;
  output.set(padding, offset); offset += padding.length;
  output.set(unpackeddata, offset);

  return output;
}
