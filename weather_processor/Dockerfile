# Separate real NOAA scientific processor, NOT part of Streamlit deployment.
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /opt/wxstudio
# ecCodes is required for native NOAA GRIB2 unpacking via cfgrib.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libeccodes0 libeccodes-data libgomp1 && \
    rm -rf /var/lib/apt/lists/*
COPY weather_processor/requirements.txt /tmp/requirements.txt
RUN python -m pip install --no-cache-dir -r /tmp/requirements.txt
COPY weather_processor/ /opt/wxstudio/weather_processor/
ENV WX_PROCESSOR_DATA_DIR=/data/frames
RUN mkdir -p /data/frames
EXPOSE 8080
# Default container runs BOTH NOAA decoders and the read-only API on ONE
# shared filesystem; required by single-service cloud hosts. Compose uses
# explicit commands below to preserve its two-process architecture.
CMD ["python", "-m", "weather_processor.single_host"]
