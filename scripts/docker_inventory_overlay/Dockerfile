# （可选）侧步拉 OpenDota 装备；私房录像请用本机
#   python scripts/build_local_inventory_overlay.py parser.json -o overlay.json
# 构建：在 PLAB_B 根目录执行
#   docker build -f scripts/docker_inventory_overlay/Dockerfile -t plab-inventory-overlay .
#
# 运行（Windows 路径按本机改）：
#   docker run --rm -v E:/PLAB_B:/app -w /app plab-inventory-overlay ^
#     --match-id 8764477088 -o /app/out/overlay.json
#
# 再在本机或同一容器内合并：
#   python scripts/dem_result_to_slim_match.py 录像解析.json --inventory-overlay out/overlay.json -o ...

FROM python:3.12-slim
WORKDIR /app
ENV PYTHONPATH=/app
COPY . /app
ENTRYPOINT ["python", "/app/scripts/export_endgame_inventory_overlay.py"]
