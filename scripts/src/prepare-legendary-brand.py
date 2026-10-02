"""Extract the supplied artwork's original gold pixels; never redraw the logo."""
from collections import deque
from pathlib import Path
import shutil
import struct
import zlib

SOURCE = Path("attached_assets/20b903bb-c3f3-42fb-9a0e-ad29df7afa23_1790954469940.png")
OUT = Path("artifacts/hypertrophy-tracker/public/brand")


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)


def decode_png(path):
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "The supplied artwork must be PNG."
    pos, compressed, header = 8, bytearray(), None
    while pos < len(data):
        size = struct.unpack(">I", data[pos:pos + 4])[0]
        kind, payload = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + size]
        if kind == b"IHDR":
            header = payload
        elif kind == b"IDAT":
            compressed.extend(payload)
        pos += size + 12
    width, height, bits, color, _, _, interlace = struct.unpack(">IIBBBBB", header)
    assert bits == 8 and color in (2, 6) and not interlace, "Unsupported PNG encoding."
    channels, stride = (4 if color == 6 else 3), width * (4 if color == 6 else 3)
    filtered = zlib.decompress(compressed)
    previous, rgb, pos = bytearray(stride), bytearray(width * height * 3), 0
    for y in range(height):
        filt = filtered[pos]
        row = bytearray(filtered[pos + 1:pos + 1 + stride])
        pos += stride + 1
        for i in range(stride):
            a = row[i - channels] if i >= channels else 0
            b = previous[i]
            c = previous[i - channels] if i >= channels else 0
            if filt == 0:
                predictor = 0
            elif filt == 1:
                predictor = a
            elif filt == 2:
                predictor = b
            elif filt == 3:
                predictor = (a + b) // 2
            elif filt == 4:
                p = a + b - c
                distances = (abs(p - a), abs(p - b), abs(p - c))
                predictor = (a, b, c)[distances.index(min(distances))]
            else:
                raise ValueError("Invalid PNG filter")
            row[i] = (row[i] + predictor) & 255
        previous = row
        for x in range(width):
            start = (y * width + x) * 3
            rgb[start:start + 3] = row[x * channels:x * channels + 3]
    return width, height, rgb


def write_rgba(path, width, height, pixels):
    rows = b"".join(b"\x00" + pixels[y * width * 4:(y + 1) * width * 4] for y in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b""))


def crop_mask(width, height, rgb, mask):
    indices = [i for i, value in enumerate(mask) if value]
    assert indices, "No gold foreground found."
    left, right = min(i % width for i in indices), max(i % width for i in indices) + 1
    top, bottom = min(i // width for i in indices), max(i // width for i in indices) + 1
    w, h = right - left, bottom - top
    result = bytearray(w * h * 4)
    for y in range(h):
        for x in range(w):
            old = (top + y) * width + left + x
            new = (y * w + x) * 4
            result[new:new + 3] = rgb[old * 3:old * 3 + 3]
            result[new + 3] = 255 if mask[old] else 0
    return w, h, result


def square_icon(width, height, source, size):
    # Supersampled original pixels, preserving the dragon's original proportions.
    scale = (size * 0.88) / max(width, height)
    offset_x, offset_y = (size - width * scale) / 2, (size - height * scale) / 2
    result = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            colors = [0.0, 0.0, 0.0]
            for sy in (0.25, 0.75):
                for sx in (0.25, 0.75):
                    px, py = int((x + sx - offset_x) / scale), int((y + sy - offset_y) / scale)
                    alpha, rgb = 0, (17, 17, 17)
                    if 0 <= px < width and 0 <= py < height:
                        i = (py * width + px) * 4
                        alpha, rgb = source[i + 3] / 255, source[i:i + 3]
                    for c in range(3):
                        colors[c] += (rgb[c] * alpha + 17 * (1 - alpha)) / 4
            i = (y * size + x) * 4
            result[i:i + 4] = bytes([round(v) for v in colors] + [255])
    return result


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SOURCE, OUT / "legendary-artwork.png")
    width, height, rgb = decode_png(SOURCE)
    mask = bytearray(width * height)
    for i in range(width * height):
        r, g, b = rgb[i * 3:i * 3 + 3]
        mask[i] = r > 18 and g > 12 and g - b > 5 and r - b > 10 and r >= g * 0.85
    logo_w, logo_h, logo = crop_mask(width, height, rgb, mask)
    write_rgba(OUT / "legendary-logo.png", logo_w, logo_h, logo)
    visited, largest = bytearray(len(mask)), []
    components = []
    for start, present in enumerate(mask):
        if not present or visited[start]:
            continue
        visited[start] = 1
        queue, component = deque([start]), []
        while queue:
            i = queue.popleft()
            component.append(i)
            x, y = i % width, i // width
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if not dx and not dy:
                        continue
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < width and 0 <= ny < height:
                        n = ny * width + nx
                        if mask[n] and not visited[n]:
                            visited[n] = 1
                            queue.append(n)
        components.append(len(component))
        if len(component) > len(largest):
            largest = component
    dragon_mask = bytearray(len(mask))
    for i in largest:
        x, y = i % width, i // width
        # Some extruded lettering touches the long tail. A compact head/arrow
        # crop cleanly excludes those letters without painting or redrawing.
        if x >= width * 0.42 and y < height * 0.49:
            dragon_mask[i] = 1
    dragon_w, dragon_h, dragon = crop_mask(width, height, rgb, dragon_mask)
    write_rgba(OUT / "dragon-mark.png", dragon_w, dragon_h, dragon)
    for size in (192, 512):
        write_rgba(OUT / f"dragon-{size}.png", size, size, square_icon(dragon_w, dragon_h, dragon, size))
    print(f"Original artwork preserved; logo {logo_w}×{logo_h}; dragon {dragon_w}×{dragon_h}.")
    print(f"Gold connected components (largest first): {sorted(components, reverse=True)[:8]}")