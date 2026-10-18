# Dedicated scientific processing image; DO NOT install these libraries in Streamlit.
FROM python:3.11-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv/wx-studio
RUN apt-get update && apt-get install -y --no-install-recommends \
  libeccodes-dev libhdf5-dev libnetcdf-dev libgomp1 ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY studio/weather/ingest/requirements-worker.txt /tmp/noaa-worker.txt
RUN python -m pip install --disable-pip-version-check --no-cache-dir -r /tmp/noaa-worker.txt
COPY studio/weather /srv/wx-studio/studio/weather
RUN useradd -r -u 10001 wxworker && mkdir -p /data/frames && chown -R wxworker:wxworker /data/frames
USER wxworker
ENV WX_WEATHER_FRAME_ROOT=/data/frames
EXPOSE 8788
CMD ["python","-m","studio.weather.ingest.service","--root","/data/frames","--host","0.0.0.0"]
