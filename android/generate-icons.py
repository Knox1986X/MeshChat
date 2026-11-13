#!/usr/bin/env python3
# Генератор растровых PNG-иконок MeshChat (mdpi..xxxhdpi) на чистом Python (zlib + struct)
import math
import os
import struct
import zlib

DENSITIES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}


def dist_to_segment(px, py, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(px - x1, py - y1)
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))


def render_icon(size):
    rows = []
    nodes = [(0.50, 0.32), (0.35, 0.43), (0.65, 0.43), (0.40, 0.62), (0.60, 0.62)]
    edges = [
        (0, 1), (0, 2), (1, 3), (2, 4), (3, 4), (1, 4), (2, 3)
    ]

    for y in range(size):
        row = bytearray([0])  # PNG filter type 0
        ny = (y + 0.5) / size
        for x in range(size):
            nx = (x + 0.5) / size

            # Скруглённый квадрат фона
            rx = max(0.0, abs(nx - 0.5) - 0.28)
            ry = max(0.0, abs(ny - 0.5) - 0.28)
            if math.hypot(rx, ry) > 0.22:
                row.extend((0, 0, 0, 0))
                continue

            # Графитово-обсидиановый фон без фиолетового оттенка
            t_bg = (nx + ny) * 0.5
            r = int(20 * (1 - t_bg) + 9 * t_bg)
            g = int(27 * (1 - t_bg) + 11 * t_bg)
            b = int(38 * (1 - t_bg) + 15 * t_bg)

            # Геометрия щита
            dx = abs(nx - 0.5)
            in_shield = False
            if 0.16 <= ny <= 0.48:
                top_line = 0.16 + dx * 0.36
                if ny >= top_line and dx <= 0.30:
                    in_shield = True
            elif 0.48 < ny <= 0.84:
                t_sh = (ny - 0.48) / 0.36
                max_w = 0.30 * (1.0 - t_sh * t_sh * 0.92)
                if dx <= max_w:
                    in_shield = True

            if in_shield:
                tg = (nx + ny) * 0.5
                r = int(37 * (1 - tg) + 30 * tg)
                g = int(99 * (1 - tg) + 58 * tg)
                b = int(235 * (1 - tg) + 138 * tg)

                # Линии Mesh-созвездия
                on_white = False
                for i, j in edges:
                    d = dist_to_segment(nx, ny, nodes[i][0], nodes[i][1], nodes[j][0], nodes[j][1])
                    if d <= 0.016:
                        on_white = True
                        break
                # Вершины Mesh-созвездия
                for cx, cy in nodes:
                    if math.hypot(nx - cx, ny - cy) <= 0.043:
                        on_white = True
                        break

                if on_white:
                    r, g, b = 255, 255, 255

            row.extend((r, g, b, 255))
        rows.append(bytes(row))

    raw = b"".join(rows)

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def main():
    base_res = os.path.join(os.path.dirname(os.path.abspath(__file__)), "res")
    for folder, px in DENSITIES.items():
        out_dir = os.path.join(base_res, folder)
        os.makedirs(out_dir, exist_ok=True)
        with open(os.path.join(out_dir, "ic_launcher.png"), "wb") as f:
            f.write(render_icon(px))


if __name__ == "__main__":
    main()
