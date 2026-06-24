import sys
import os
from PIL import Image

src_path = r"C:\Users\yumji\Downloads\Gemini_Generated_Image_n1p9x0n1p9x0n1p9 (1).png"
dest_path = r"E:\CLAUDE-CODE\깃허브\github-rainbow-v3.ico"

if not os.path.exists(src_path):
    print(f"[에러] 소스 파일을 찾을 수 없습니다: {src_path}")
    sys.exit(1)

try:
    print(f"이미지 로딩 중: {src_path}")
    img = Image.open(src_path).convert("RGBA")
    width, height = img.size
    print(f"원본 이미지 크기: {width}x{height}")

    # Crop outer 12% margin to force-remove the border card/box lines
    margin_w = int(width * 0.12)
    margin_h = int(height * 0.12)
    img = img.crop((margin_w, margin_h, width - margin_w, height - margin_h))
    width, height = img.size
    print(f"외곽 테두리 12% 깎아낸 크기: {width}x{height}")

    # Detect background color using top-left corner pixel (0,0) of the cropped image
    bg_color = img.getpixel((0, 0))[:3]
    print(f"감지된 배경색 (RGB): {bg_color}")

    # BFS Flood fill to transparentize outer background
    visited = [[False] * height for _ in range(width)]
    pixels = img.load()
    
    # Distance threshold for background matching
    THRESHOLD = 50

    def color_dist(c1, c2):
        return ((c1[0] - c2[0])**2 + (c1[1] - c2[1])**2 + (c1[2] - c2[2])**2)**0.5

    queue = []
    
    # Enqueue all boundary pixels
    for x in range(width):
        queue.append((x, 0))
        queue.append((x, height - 1))
        visited[x][0] = True
        visited[x][height - 1] = True

    for y in range(height):
        queue.append((0, y))
        queue.append((width - 1, y))
        visited[0][y] = True
        visited[width - 1][y] = True

    # Run BFS
    head = 0
    transparent_count = 0
    while head < len(queue):
        cx, cy = queue[head]
        head += 1
        
        current_color = pixels[cx, cy][:3]
        if color_dist(current_color, bg_color) < THRESHOLD:
            # Set alpha channel to 0
            pixels[cx, cy] = (current_color[0], current_color[1], current_color[2], 0)
            transparent_count += 1
            
            # Explore 4-way neighbors
            for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                nx, ny = cx + dx, cy + dy
                if 0 <= nx < width and 0 <= ny < height:
                    if not visited[nx][ny]:
                        visited[nx][ny] = True
                        queue.append((nx, ny))

    print(f"배경 투명화 처리 완료 (투명화된 픽셀: {transparent_count}개)")

    # Crop out the white margin/padding to maximize the Octocat size
    bbox = img.getbbox()
    if bbox:
        left, upper, right, lower = bbox
        print(f"감지된 고양이 경계 상자: {bbox}")
        
        w = right - left
        h = lower - upper
        size = max(w, h)
        
        # Create a new transparent square canvas to preserve aspect ratio (1:1)
        square_img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        
        # Paste the cropped Octocat in the center
        offset_x = (size - w) // 2
        offset_y = (size - h) // 2
        cropped_octocat = img.crop((left, upper, right, lower))
        square_img.paste(cropped_octocat, (offset_x, offset_y))
        
        img = square_img
        print(f"여백 제거 및 정사각형 캔버스 배치 완료 (크기: {size}x{size})")
    else:
        print("[경고] 유효한 이미지 경계 상자를 찾을 수 없습니다. 원본 스케일로 진행합니다.")

    # Save as standard multi-size Windows ICO file
    img.save(dest_path, format="ICO", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    print(f"[성공] 고양이가 극대화된 멀티사이즈 ICO 변환 완료: {dest_path}")

except Exception as e:
    print(f"[실패] 이미지 변환 도중 예외 발생: {str(e)}")
    sys.exit(1)
