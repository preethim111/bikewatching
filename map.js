// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

mapboxgl.accessToken = 'pk.eyJ1IjoicHJlZXRoaW1hbm5lMTEiLCJhIjoiY21hanV6OTQyMDFtMDJ0cHd3a255c2R1NiJ9.WNtaIBDjzgftpgx3tXuntg';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);
let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

map.on('load', async () => {
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': '#32D400',
      'line-width': 4,
      'line-opacity': 0.5,
    },
  });

  const svg = d3.select(map.getCanvasContainer())
    .append('svg')
    .style('position', 'absolute')
    .style('top', 0)
    .style('left', 0)
    .style('width', '100%')
    .style('height', '100%');

  let jsonData = await d3.json("https://dsc106.com/labs/lab07/data/bluebikes-stations.json");
  const originalStations = jsonData.data.stations;

  let trips = await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);
      const startMin = minutesSinceMidnight(trip.started_at);
      const endMin = minutesSinceMidnight(trip.ended_at);
      departuresByMinute[startMin].push(trip);
      arrivalsByMinute[endMin].push(trip);
      return trip;
    }
  );

  const stations = computeStationTraffic(originalStations);

  const radiusScale = d3.scaleSqrt()
    .domain([0, d3.max(stations, d => d.totalTraffic)])
    .range([0, 25]);

  let circles = svg.selectAll('circle')
    .data(stations, d => d.short_name)
    .enter()
    .append('circle')
    .attr('r', d => radiusScale(d.totalTraffic))
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('opacity', 0.8)
    .attr('cx', d => getCoords(d).cx)
    .attr('cy', d => getCoords(d).cy)
    .style('--departure-ratio', d => stationFlow(d.totalTraffic === 0 ? 0 : d.departures / d.totalTraffic));

  circles.append('title')
    .text(d => `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);

  function updatePositions() {
    svg.selectAll('circle')
      .attr('cx', d => getCoords(d).cx)
      .attr('cy', d => getCoords(d).cy);
  }

  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  function updateTimeDisplay() {
    const timeFilter = Number(timeSlider.value);
    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }
    updateScatterPlot(timeFilter);
  }

  function updateScatterPlot(timeFilter) {
    const filteredStations = computeStationTraffic(originalStations, timeFilter);

    timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

    circles = svg.selectAll('circle')
      .data(filteredStations, d => d.short_name)
      .join(
        enter => {
          const newCircles = enter.append('circle')
            .attr('stroke', 'white')
            .attr('stroke-width', 1)
            .attr('opacity', 0.8)
            .attr('r', d => radiusScale(d.totalTraffic))
            .attr('cx', d => getCoords(d).cx)
            .attr('cy', d => getCoords(d).cy)
            .style('--departure-ratio', d => stationFlow(d.totalTraffic === 0 ? 0 : d.departures / d.totalTraffic));
          newCircles.append('title')
            .text(d => `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
          return newCircles;
        },
        update => update
          .attr('r', d => radiusScale(d.totalTraffic))
          .attr('cx', d => getCoords(d).cx)
          .attr('cy', d => getCoords(d).cy)
          .style('--departure-ratio', d => stationFlow(d.totalTraffic === 0 ? 0 : d.departures / d.totalTraffic))
          .select('title')
          .text(d => `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`),
        exit => exit.remove()
      );
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    v => v.length,
    d => d.start_station_id
  );
  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    v => v.length,
    d => d.end_station_id
  );

  return stations.map(station => {
    let id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) return tripsByMinute.flat();
  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;
  if (minMinute > maxMinute) {
    return tripsByMinute.slice(minMinute).flat()
      .concat(tripsByMinute.slice(0, maxMinute).flat());
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}
