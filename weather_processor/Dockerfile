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
CMD ["uvicorn", "weather_processor.service:APP", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers"]
