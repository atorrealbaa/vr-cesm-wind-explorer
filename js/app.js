(function () {
	'use strict';
	const errorBannerEl = document.getElementById('error-banner');

	function showError(message) {
		console.error(message);
		errorBannerEl.textContent = message;
		errorBannerEl.classList.remove('hidden');
	}

	window.addEventListener('error', (event) => showError(`Script error: ${event.message}`));
	window.addEventListener('unhandledrejection', (event) => showError(`Script error: ${event.reason}`));

	const seasonButtons = Array.from(document.querySelectorAll('.season-btn'));
	const seasonNoteEl = document.getElementById('season-note');
	const speedHeightSelectEl = document.getElementById('speed-height-select');
	const speedHeightDetailNoteEl = document.getElementById('speed-height-detail-note');
	const shearToggleEl = document.getElementById('shear-toggle');
	const layerNoteEl = document.getElementById('layer-note');
	const legendContentEl = document.getElementById('legend-content');
	const thresholdSliderEl = document.getElementById('threshold-slider');
	const thresholdLabelEl = document.getElementById('threshold-label');
	const shearThresholdRowEl = document.getElementById('shear-threshold-row');
	const shearThresholdSliderEl = document.getElementById('shear-threshold-slider');
	const shearThresholdLabelEl = document.getElementById('shear-threshold-label');
	const turbineToggleEl = document.getElementById('turbine-toggle');
	const loadingEl = document.getElementById('loading-indicator');
	const dividerEl = document.getElementById('swipe-divider');
	const dividerHandleEl = document.getElementById('swipe-handle');
	const mapStageEl = document.getElementById('map-stage');
	const historicalMapContainerEl = document.getElementById('map-historical');
	const futureMapContainerEl = document.getElementById('map-future');
	const mapAttributionEl = document.getElementById('map-attribution');
	const appHeaderEl = document.getElementById('app-header');
	const historicalLabelEl = document.getElementById('period-label-left');
	const addLayerFileInputEl = document.getElementById('add-layer-file-input');
	const disclaimerOverlayEl = document.getElementById('disclaimer-overlay');
	const disclaimerDismissBtnEl = document.getElementById('disclaimer-dismiss-btn');
	const disclaimerDontShowAgainEl = document.getElementById('disclaimer-dont-show-again');

	const state = {
		season: 'ANNUAL',
		speedHeight: 'Z2', 
		shearEnabled: true,
		threshold: CONFIG.thresholds.speed.default,
		shearThreshold: CONFIG.thresholds.shear.default,
		turbinesVisible: true,
		dividerPercent: 50,
	};

	// left and right sides as INDIVIDUAL Leaflet maps, to prevent historical side bug
	let historicalMap = null;
	let futureMap = null;
	let mapsReady = false;
	let hasFitBoundsOnce = false;
	let reloadGeneration = 0;

	const mapContentGroups = { historical: null, future: null };

	const turbineLayers = { historical: null, future: null };

	const addedUserLayers = { historical: null, future: null };

	const geoJsonCache = new Map();

	function debounce(fn, delayMs) {
		let timer = null;
		return (...args) => {
			clearTimeout(timer);
			timer = setTimeout(() => fn(...args), delayMs);
		};
	}

	function showDisclaimerIfNeeded() {
		let dismissedBefore = false;
		try {
			dismissedBefore = localStorage.getItem(CONFIG.disclaimerStorageKey) === '1';
		} catch (err) {
		}
		if (!dismissedBefore) disclaimerOverlayEl.classList.remove('hidden');
	}

	disclaimerDismissBtnEl.addEventListener('click', () => {
		disclaimerOverlayEl.classList.add('hidden');
		if (disclaimerDontShowAgainEl.checked) {
			try {
				localStorage.setItem(CONFIG.disclaimerStorageKey, '1');
			} catch (err) {
			}
		}
	});

	function currentStyleFn(feature) {
		const props = feature.properties || {};
		const matches = props.band_low >= state.threshold;
		return matches ? CONFIG.style.highlighted : CONFIG.style.dimmed;
	}

	function speedDataUrls() {
		return {
			historical: CONFIG.dataPaths.speed(state.speedHeight, state.season, 'historical'),
			future: CONFIG.dataPaths.speed(state.speedHeight, state.season, 'future'),
		};
	}

	function shearDataUrls() {
		return {
			historical: CONFIG.dataPaths.shear(state.season, 'historical'),
			future: CONFIG.dataPaths.shear(state.season, 'future'),
		};
	}

	function seasonsAllowedForCurrentHeight() {
		return CONFIG.seasonsByHeight[state.speedHeight] || ['ANNUAL'];
	}

	function updateThresholdLabel() {
		thresholdLabelEl.textContent = CONFIG.thresholds.speed.label(state.threshold);
	}

	function updateShearThresholdLabel() {
		shearThresholdLabelEl.textContent = CONFIG.thresholds.shear.label(state.shearThreshold);
	}

	function updateThresholdControls() {
		thresholdSliderEl.min = CONFIG.thresholds.speed.min;
		thresholdSliderEl.max = CONFIG.thresholds.speed.max;
		thresholdSliderEl.step = CONFIG.thresholds.speed.step;
		updateThresholdLabel();

		shearThresholdRowEl.classList.toggle('hidden', !state.shearEnabled);
		if (state.shearEnabled) {
			shearThresholdSliderEl.min = CONFIG.thresholds.shear.min;
			shearThresholdSliderEl.max = CONFIG.thresholds.shear.max;
			shearThresholdSliderEl.step = CONFIG.thresholds.shear.step;
			updateShearThresholdLabel();
		}
	}

	function updateSeasonButtonsForHeight() {
		const allowed = seasonsAllowedForCurrentHeight();
		let switchedAway = false;

		seasonButtons.forEach((button) => {
			const season = button.dataset.season;
			const isAllowed = allowed.includes(season);
			button.disabled = !isAllowed;
			if (!isAllowed && state.season === season) switchedAway = true;
		});

		if (switchedAway) state.season = 'ANNUAL';

		seasonButtons.forEach((button) => {
			const isActive = button.dataset.season === state.season;
			button.classList.toggle('active', isActive);
			button.setAttribute('aria-pressed', String(isActive));
		});

		seasonNoteEl.textContent = allowed.length === 1 ? 'This height only has an annual mean available.' : '';
	}

	function updateSpeedHeightDetailNote() {
		speedHeightDetailNoteEl.textContent = CONFIG.speedHeightDetails[state.speedHeight] || '';
	}

	function legendRow(color, label, isCircle) {
		const rowEl = document.createElement('div');
		rowEl.className = 'legend-row';
		const swatchEl = document.createElement('span');
		swatchEl.className = 'legend-swatch';
		swatchEl.style.backgroundColor = color;
		if (isCircle) swatchEl.style.borderRadius = '50%';
		const labelEl = document.createElement('span');
		labelEl.textContent = label;
		rowEl.appendChild(swatchEl);
		rowEl.appendChild(labelEl);
		return rowEl;
	}

	function updateLegend() {
		legendContentEl.innerHTML = '';
		if (state.shearEnabled) {
			legendContentEl.appendChild(legendRow(CONFIG.combinedCompliance.speedOnlyColor, 'Wind speed compliant'));
			legendContentEl.appendChild(legendRow(CONFIG.combinedCompliance.shearOnlyColor, 'Wind shear compliant'));
			legendContentEl.appendChild(legendRow(CONFIG.combinedCompliance.bothColor, 'Both compliant'));
		} else {
			legendContentEl.appendChild(legendRow(CONFIG.style.highlighted.fillColor, 'Meets threshold'));
			legendContentEl.appendChild(legendRow(CONFIG.style.dimmed.fillColor, 'Below threshold'));
		}
		legendContentEl.appendChild(legendRow('#ffb703', 'Wind turbines (Canadian Wind Turbine Database)', true));
	}

	function setLoading(isLoading) {
		loadingEl.classList.toggle('hidden', !isLoading);
	}

	function positionAppHeader() {
		if (!appHeaderEl) return;
		const headerHeight = appHeaderEl.getBoundingClientRect().height;
		document.documentElement.style.setProperty('--app-header-height', `${headerHeight}px`);
	}

	// lower clickable zoom controls to avoid overlapping header
	function positionZoomControl() {
		if (!historicalLabelEl) return;
		const labelRect = historicalLabelEl.getBoundingClientRect();
		const mapRect = mapStageEl.getBoundingClientRect();
		const gap = 12;
		const offset = labelRect.bottom + gap - mapRect.top;
		document.documentElement.style.setProperty('--zoom-control-top-offset', `${offset}px`);
	}

	// swipe divider
	function applyDividerPosition(percent) {
		state.dividerPercent = percent;
		dividerEl.style.left = `${percent}%`;
		dividerHandleEl.setAttribute('aria-valuenow', String(Math.round(percent)));
		futureMapContainerEl.style.clipPath = `inset(0 0 0 ${percent}%)`;
	}

	const DIVIDER_MIN_PERCENT = 4;
	const DIVIDER_MAX_PERCENT = 96;

	function wireDividerDrag() {
		let dragging = false;

		function percentFromClientX(clientX) {
			const rect = mapStageEl.getBoundingClientRect();
			const raw = ((clientX - rect.left) / rect.width) * 100;
			return Math.min(DIVIDER_MAX_PERCENT, Math.max(DIVIDER_MIN_PERCENT, raw));
		}

		dividerHandleEl.addEventListener('pointerdown', (event) => {
			dragging = true;
			dividerHandleEl.setPointerCapture(event.pointerId);
		});
		dividerHandleEl.addEventListener('pointermove', (event) => {
			if (!dragging) return;
			applyDividerPosition(percentFromClientX(event.clientX));
		});
		dividerHandleEl.addEventListener('pointerup', (event) => {
			dragging = false;
			try {
				dividerHandleEl.releasePointerCapture(event.pointerId);
			} catch (err) {
			}
		});

		// keyboard-only aria support
		dividerHandleEl.addEventListener('keydown', (event) => {
			const smallStep = 2;
			const largeStep = 10;
			let nextPercent = null;
			switch (event.key) {
				case 'ArrowLeft':
				case 'ArrowDown':
					nextPercent = state.dividerPercent - smallStep;
					break;
				case 'ArrowRight':
				case 'ArrowUp':
					nextPercent = state.dividerPercent + smallStep;
					break;
				case 'PageDown':
					nextPercent = state.dividerPercent - largeStep;
					break;
				case 'PageUp':
					nextPercent = state.dividerPercent + largeStep;
					break;
				case 'Home':
					nextPercent = DIVIDER_MIN_PERCENT;
					break;
				case 'End':
					nextPercent = DIVIDER_MAX_PERCENT;
					break;
				default:
					return;
			}
			event.preventDefault();
			applyDividerPosition(Math.min(DIVIDER_MAX_PERCENT, Math.max(DIVIDER_MIN_PERCENT, nextPercent)));
		});
	}

	async function fetchGeoJson(url) {
		if (geoJsonCache.has(url)) return geoJsonCache.get(url);

		let response;
		try {
			response = await fetch(url);
		} catch (networkErr) {
			throw new Error(
				`Network error loading ${url}: ${networkErr.message}. If you're opening index.html ` +
					'directly from disk, browsers block fetch() for local files - serve this folder with ' +
					'"python -m http.server" (or similar) locally, or view it via GitHub Pages instead.'
			);
		}
		if (!response.ok) {
			throw new Error(`${url} -> HTTP ${response.status} ${response.statusText}`);
		}
		let data;
		try {
			data = await response.json();
		} catch (parseErr) {
			throw new Error(`${url} loaded but did not parse as JSON: ${parseErr.message}`);
		}
		geoJsonCache.set(url, data);
		return data;
	}

	function combinedLonBounds(...geojsons) {
		let west = Infinity;
		let east = -Infinity;
		for (const geojson of geojsons) {
			for (const feature of geojson.features || []) {
				const bounds = L.geoJSON(feature).getBounds();
				if (!bounds.isValid()) continue;
				west = Math.min(west, bounds.getWest());
				east = Math.max(east, bounds.getEast());
			}
		}
		return { west, east };
	}

	function assertLongitudeInRange(...geojsons) {
		const { west, east } = combinedLonBounds(...geojsons);
		if (!isFinite(west) || !isFinite(east)) return;
		if (west > 170 || east > 190) {
			throw new Error(
				`lat-long Error`
			);
		}
	}

	function setMapContent(which, layers) {
		const targetMap = which === 'historical' ? historicalMap : futureMap;
		if (mapContentGroups[which]) {
			targetMap.removeLayer(mapContentGroups[which]);
		}
		const group = L.layerGroup(layers.filter(Boolean)).addTo(targetMap);
		mapContentGroups[which] = group;
	}

	function buildOuterBoundaryLayer(featureCollection) {
		try {
			if (!featureCollection.features || featureCollection.features.length === 0) return null;
			if (typeof turf === 'undefined') return null;
			const dissolved = turf.union(featureCollection);
			if (!dissolved) return null;
			return L.geoJSON(dissolved, {
				pane: 'dataPane',
				interactive: false,
				style: () => CONFIG.style.outerBoundary,
			});
		} catch (err) {
			console.warn('Could not compute outer study-area boundary (fills still render fine):', err.message);
			return null;
		}
	}

	function maybeFitBoundsOnce(layerWithBounds) {
		if (hasFitBoundsOnce) return;
		try {
			const bounds = layerWithBounds.getBounds();
			if (bounds.isValid()) {
				historicalMap.fitBounds(bounds, { padding: [20, 20] });
				hasFitBoundsOnce = true;
			}
		} catch (err) {
		}
	}

	async function reloadSpeedOnlyLayers(myGeneration) {
		const urls = speedDataUrls();
		const [historicalGeoJson, futureGeoJson] = await Promise.all([
			fetchGeoJson(urls.historical),
			fetchGeoJson(urls.future),
		]);

		if (myGeneration !== reloadGeneration) return;

		const historicalCount = (historicalGeoJson.features || []).length;
		const futureCount = (futureGeoJson.features || []).length;

		assertLongitudeInRange(historicalGeoJson, futureGeoJson);

		const historicalDataLayer = L.geoJSON(historicalGeoJson, { pane: 'dataPane', style: currentStyleFn });
		const futureDataLayer = L.geoJSON(futureGeoJson, { pane: 'dataPane', style: currentStyleFn });
		const historicalBoundary = buildOuterBoundaryLayer(historicalGeoJson);
		const futureBoundary = buildOuterBoundaryLayer(futureGeoJson);

		if (myGeneration !== reloadGeneration) return;

		setMapContent('historical', [historicalDataLayer, historicalBoundary]);
		setMapContent('future', [futureDataLayer, futureBoundary]);

		if (historicalCount === 0 && futureCount === 0) {
			layerNoteEl.style.color = '#b45309';
			layerNoteEl.textContent = 'No data available for this selection.';
		} else {
			layerNoteEl.style.color = '';
			layerNoteEl.textContent = '';
		}

		maybeFitBoundsOnce(historicalDataLayer);
	}

	// color brewer palette below
	function buildCombinedComplianceLayers(speedGeoJson, shearGeoJson) {
		const speedCompliant = {
			type: 'FeatureCollection',
			features: (speedGeoJson.features || []).filter((f) => (f.properties || {}).band_low >= state.threshold),
		};
		const shearCompliant = {
			type: 'FeatureCollection',
			features: (shearGeoJson.features || []).filter(
				(f) => (f.properties || {}).band_high <= state.shearThreshold
			),
		};

		let speedUnion = null;
		let shearUnion = null;
		try {
			if (speedCompliant.features.length) speedUnion = turf.union(speedCompliant);
		} catch (err) {
			console.warn('Combined view: could not union speed-compliant region:', err.message);
		}
		try {
			if (shearCompliant.features.length) shearUnion = turf.union(shearCompliant);
		} catch (err) {
			console.warn('Combined view: could not union shear-compliant region:', err.message);
		}

		const layers = [];
		const addRegion = (geometry, color) => {
			if (!geometry) return;
			layers.push(
				L.geoJSON(geometry, {
					pane: 'dataPane',
					interactive: false,
					style: () => ({ stroke: false, fillColor: color, fillOpacity: CONFIG.combinedCompliance.fillOpacity }),
				})
			);
		};

		if (speedUnion && shearUnion) {
			try {
				addRegion(
					turf.difference(turf.featureCollection([speedUnion, shearUnion])),
					CONFIG.combinedCompliance.speedOnlyColor
				);
			} catch (err) {
				console.warn('Combined view: could not compute speed-only region:', err.message);
			}
			try {
				addRegion(
					turf.difference(turf.featureCollection([shearUnion, speedUnion])),
					CONFIG.combinedCompliance.shearOnlyColor
				);
			} catch (err) {
				console.warn('Combined view: could not compute shear-only region:', err.message);
			}
			try {
				addRegion(
					turf.intersect(turf.featureCollection([speedUnion, shearUnion])),
					CONFIG.combinedCompliance.bothColor
				);
			} catch (err) {
				console.warn('Combined view: could not compute both-compliant region:', err.message);
			}
		} else if (speedUnion) {
			addRegion(speedUnion, CONFIG.combinedCompliance.speedOnlyColor);
		} else if (shearUnion) {
			addRegion(shearUnion, CONFIG.combinedCompliance.shearOnlyColor);
		}

		return layers;
	}

	async function reloadCombinedLayers(myGeneration) {
		if (typeof turf === 'undefined') {
			throw new Error('Turf.js failed to load from CDN - the combined speed+shear view needs it to compute compliance regions.');
		}

		const speedUrls = speedDataUrls();
		const shearUrls = shearDataUrls();

		const [speedHist, speedFuture, shearHist, shearFuture] = await Promise.all([
			fetchGeoJson(speedUrls.historical),
			fetchGeoJson(speedUrls.future),
			fetchGeoJson(shearUrls.historical),
			fetchGeoJson(shearUrls.future),
		]);

		if (myGeneration !== reloadGeneration) return;

		assertLongitudeInRange(speedHist, speedFuture, shearHist, shearFuture);

		const historicalLayers = buildCombinedComplianceLayers(speedHist, shearHist);
		const futureLayers = buildCombinedComplianceLayers(speedFuture, shearFuture);
		const historicalBoundary = buildOuterBoundaryLayer(speedHist);
		const futureBoundary = buildOuterBoundaryLayer(speedFuture);

		if (myGeneration !== reloadGeneration) return;

		setMapContent('historical', [...historicalLayers, historicalBoundary]);
		setMapContent('future', [...futureLayers, futureBoundary]);

		layerNoteEl.style.color = '';
		layerNoteEl.textContent = '';

		if (!hasFitBoundsOnce) {
			const probe = L.geoJSON(speedHist);
			maybeFitBoundsOnce(probe);
		}
	}

	async function reloadMapLayers() {
		if (!mapsReady) return;
		const myGeneration = ++reloadGeneration;
		setLoading(true);
		layerNoteEl.style.color = '';
		layerNoteEl.textContent = '';
		try {
			if (state.shearEnabled) {
				await reloadCombinedLayers(myGeneration);
			} else {
				await reloadSpeedOnlyLayers(myGeneration);
			}
		} catch (err) {
			if (myGeneration !== reloadGeneration) return;
			console.error('Failed to load layer data:', err);
			layerNoteEl.style.color = '#b45309';
			layerNoteEl.textContent = 'Sorry, this data could not be loaded. Please try again or reload the page.';
		} finally {
			if (myGeneration === reloadGeneration) setLoading(false);
		}
	}

	const debouncedReload = debounce(reloadMapLayers, 150);

	async function setTurbinesVisible(visible) {
		if (!mapsReady) return;
		if (!turbineLayers.historical || !turbineLayers.future) {
			layerNoteEl.style.color = '#b45309';
			layerNoteEl.textContent = 'The wind turbine layer could not be loaded. Please try reloading the page.';
			turbineToggleEl.checked = false;
			return;
		}
		if (visible) {
			turbineLayers.historical.addTo(historicalMap);
			turbineLayers.future.addTo(futureMap);
		} else {
			historicalMap.removeLayer(turbineLayers.historical);
			futureMap.removeLayer(turbineLayers.future);
		}
	}

	seasonButtons.forEach((button) => {
		button.addEventListener('click', () => {
			if (button.disabled) return;
			state.season = button.dataset.season;
			seasonButtons.forEach((b) => {
				const isActive = b === button;
				b.classList.toggle('active', isActive);
				b.setAttribute('aria-pressed', String(isActive));
			});
			reloadMapLayers();
		});
	});

	speedHeightSelectEl.addEventListener('change', () => {
		state.speedHeight = speedHeightSelectEl.value;
		updateSeasonButtonsForHeight();
		updateSpeedHeightDetailNote();
		reloadMapLayers();
	});

	shearToggleEl.addEventListener('change', () => {
		state.shearEnabled = shearToggleEl.checked;
		updateThresholdControls();
		updateLegend();
		reloadMapLayers();
	});

	thresholdSliderEl.addEventListener('input', () => {
		state.threshold = Number(thresholdSliderEl.value);
		updateThresholdLabel();
		if (state.shearEnabled) {
			debouncedReload();
		} else {
			reloadMapLayers();
		}
	});

	shearThresholdSliderEl.addEventListener('input', () => {
		state.shearThreshold = Number(shearThresholdSliderEl.value);
		updateShearThresholdLabel();
		debouncedReload();
	});

	turbineToggleEl.addEventListener('change', () => {
		state.turbinesVisible = turbineToggleEl.checked;
		setTurbinesVisible(state.turbinesVisible);
	});

	// add own data button

	async function handleAddLayerFile(event) {
		const file = event.target.files && event.target.files[0];
		event.target.value = '';
		if (!file) return;

		setLoading(true);
		try {
			const nameLower = file.name.toLowerCase();
			let geojson;

			if (nameLower.endsWith('.zip')) {
				if (typeof shp === 'undefined') throw new Error('The shapefile reader could not be loaded. Please try reloading the page.');
				const arrayBuffer = await file.arrayBuffer();
				geojson = await shp(arrayBuffer);
			} else if (nameLower.endsWith('.kmz')) {
				if (typeof JSZip === 'undefined') throw new Error('The archive reader could not be loaded. Please try reloading the page.');
				if (typeof toGeoJSON === 'undefined') throw new Error('The KML reader could not be loaded. Please try reloading the page.');
				const arrayBuffer = await file.arrayBuffer();
				const zip = await JSZip.loadAsync(arrayBuffer);
				const kmlEntryName = Object.keys(zip.files).find((name) => name.toLowerCase().endsWith('.kml'));
				if (!kmlEntryName) throw new Error('No .kml file found inside this .kmz archive.');
				const kmlText = await zip.files[kmlEntryName].async('text');
				const kmlDom = new DOMParser().parseFromString(kmlText, 'text/xml');
				geojson = toGeoJSON.kml(kmlDom);
			} else {
				throw new Error(
					'Unsupported file type - choose a .zip (zipped shapefile: .shp/.shx/.dbf together) or a .kmz file.'
				);
			}

			const userLayerOptions = {
				pane: 'userDataPane',
				style: { color: '#8b5cf6', weight: 2, fillColor: '#8b5cf6', fillOpacity: 0.25 },
				pointToLayer: (feature, latlng) =>
					L.circleMarker(latlng, { radius: 5, color: '#8b5cf6', weight: 2, fillColor: '#8b5cf6', fillOpacity: 0.6 }),
			};

			if (addedUserLayers.historical) historicalMap.removeLayer(addedUserLayers.historical);
			if (addedUserLayers.future) futureMap.removeLayer(addedUserLayers.future);
			addedUserLayers.historical = L.geoJSON(geojson, userLayerOptions).addTo(historicalMap);
			addedUserLayers.future = L.geoJSON(geojson, userLayerOptions).addTo(futureMap);

			const bounds = addedUserLayers.historical.getBounds();
			if (bounds.isValid()) historicalMap.fitBounds(bounds, { padding: [20, 20] });

			layerNoteEl.style.color = '';
			layerNoteEl.textContent = `Added "${file.name}" to the map.`;
		} catch (err) {
			console.error('Failed to add layer:', err);
			layerNoteEl.style.color = '#b45309';
			layerNoteEl.textContent = `Could not add "${file.name}": ${err.message}`;
		} finally {
			setLoading(false);
		}
	}

	addLayerFileInputEl.addEventListener('change', handleAddLayerFile);

	function buildAddLayerControl() {
		const AddLayerControl = L.Control.extend({
			options: { position: 'topleft' },
			onAdd: function () {
				const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-add-layer');
				const button = L.DomUtil.create('a', '', container);
				button.href = '#';
				button.title = 'Add your own layer (shapefile .zip or .kmz)';
				button.setAttribute('aria-label', 'Add your own layer (shapefile .zip or .kmz)');
				button.innerHTML = '+';
				button.setAttribute('role', 'button');
				L.DomEvent.disableClickPropagation(container);
				L.DomEvent.on(button, 'click', (domEvent) => {
					L.DomEvent.preventDefault(domEvent);
					addLayerFileInputEl.click();
				});
				return container;
			},
		});
		return new AddLayerControl();
	}

	// reopen terms of use
	function buildInfoControl() {
		const InfoControl = L.Control.extend({
			options: { position: 'topleft' },
			onAdd: function () {
				const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-info');
				const button = L.DomUtil.create('a', '', container);
				button.href = '#';
				button.title = 'Project info, terms of use & contact';
				button.setAttribute('aria-label', 'Project info, terms of use & contact');
				button.innerHTML = '&#9432;';
				button.setAttribute('role', 'button');
				L.DomEvent.disableClickPropagation(container);
				L.DomEvent.on(button, 'click', (domEvent) => {
					L.DomEvent.preventDefault(domEvent);
					disclaimerOverlayEl.classList.remove('hidden');
				});
				return container;
			},
		});
		return new InfoControl();
	}

	positionAppHeader();
	requestAnimationFrame(positionAppHeader);
	window.addEventListener('resize', positionAppHeader);

	wireDividerDrag();
	updateThresholdControls();
	updateSeasonButtonsForHeight();
	updateSpeedHeightDetailNote();
	updateLegend();
	applyDividerPosition(state.dividerPercent);
	showDisclaimerIfNeeded();

	let canadaMaskFeaturePromise = null;

	function getCanadaMaskFeature() {
		if (!canadaMaskFeaturePromise) {
			canadaMaskFeaturePromise = (async () => {
				const countriesGeoJson = await fetchGeoJson(CONFIG.countriesGeoJsonUrl);
				const canadaFeature = (countriesGeoJson.features || []).find(
					(feature) => feature.properties && feature.properties['ISO3166-1-Alpha-3'] === 'CAN'
				);
				if (!canadaFeature) {
					throw new Error('No feature with ISO3166-1-Alpha-3 "CAN" found in the countries GeoJSON.');
				}

				const maskOuterRing = [
					[-179, -60],
					[179, -60],
					[179, 83],
					[-179, 83],
					[-179, -60],
				];
				const geometry = canadaFeature.geometry;
				const polygonParts = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
				const holeRings = polygonParts.map((rings) => rings[0]).filter(Boolean);

				return {
					type: 'Feature',
					properties: {},
					geometry: { type: 'Polygon', coordinates: [maskOuterRing, ...holeRings] },
				};
			})().catch((err) => {
				console.warn('Non-Canada mask feature unavailable (map still works without it):', err.message);
				canadaMaskFeaturePromise = null;
				return null;
			});
		}
		return canadaMaskFeaturePromise;
	}

	function maskLayerStyle() {
		return { stroke: false, fillColor: CONFIG.nonCanadaMaskColor, fillOpacity: CONFIG.nonCanadaMaskOpacity };
	}

	async function addNonCanadaMask(mapInstance) {
		const maskFeature = await getCanadaMaskFeature();
		if (!maskFeature) return;
		L.geoJSON(maskFeature, { interactive: false, style: maskLayerStyle }).addTo(mapInstance);
	}

	let greatLakesFeatureCollectionPromise = null;

	function featureMatchesGreatLakeName(feature) {
		const targetNames = ['superior', 'michigan', 'huron', 'erie', 'ontario', 'st. clair', 'saint clair'];
		const props = feature.properties || {};
		for (const key in props) {
			const value = props[key];
			if (typeof value !== 'string') continue;
			const lower = value.toLowerCase();
			if (targetNames.some((name) => lower.includes(name))) return true;
		}
		return false;
	}

	function getGreatLakesFeatureCollection() {
		if (!greatLakesFeatureCollectionPromise) {
			greatLakesFeatureCollectionPromise = (async () => {
				const lakesGeoJson = await fetchGeoJson(CONFIG.greatLakesGeoJsonUrl);
				const matched = (lakesGeoJson.features || []).filter(featureMatchesGreatLakeName);
				if (matched.length === 0) {
					console.warn('Great Lakes outline: no matching lake features found in', CONFIG.greatLakesGeoJsonUrl);
					return null;
				}
				return { type: 'FeatureCollection', features: matched };
			})().catch((err) => {
				console.warn('Great Lakes outline unavailable (map still works without it):', err.message);
				greatLakesFeatureCollectionPromise = null;
				return null;
			});
		}
		return greatLakesFeatureCollectionPromise;
	}

	async function addGreatLakesOutline(mapInstance) {
		const collection = await getGreatLakesFeatureCollection();
		if (!collection) return;
		L.geoJSON(collection, {
			pane: 'lakesPane',
			interactive: false,
			style: () => CONFIG.style.greatLakesOutline,
		}).addTo(mapInstance);
	}

	function turbineClusterIcon(cluster) {
		const count = cluster.getChildCount();
		const size = count < 10 ? 20 : count < 50 ? 26 : count < 200 ? 34 : 42;
		return L.divIcon({
			html:
				`<div style="background:#ffb703;border:2px solid #333;border-radius:50%;` +
				`width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;` +
				`font-weight:bold;color:#1a1a1a;">${count}</div>`,
			className: 'turbine-cluster-icon',
			iconSize: L.point(size, size),
		});
	}

	function buildTurbineLayer() {
		if (typeof L.esri === 'undefined') {
			console.warn('Esri Leaflet failed to load from CDN - turbine layer will be unavailable.');
			return null;
		}
		const pointStyle = (geojsonFeature, latlng) =>
			L.circleMarker(latlng, { radius: 3, color: '#333', weight: 1, fillColor: '#ffb703', fillOpacity: 0.9 });

		const attribution =
			'Canadian Wind Turbine Database sourced from ' +
			`<a href="${CONFIG.turbines.creditUrl}" target="_blank" rel="noopener">Natural Resources Canada</a>`;

		const clusteringAvailable = typeof L.esri.Cluster !== 'undefined';
		if (!clusteringAvailable) {
			console.warn('esri-leaflet-cluster failed to load from CDN - turbines will render unclustered.');
		}

		const sublayers = CONFIG.turbines.layerIds.map((layerId) => {
			const url = `${CONFIG.turbines.restBaseUrl}/${layerId}`;
			return clusteringAvailable
				? L.esri.Cluster.featureLayer({ url, pointToLayer: pointStyle, attribution, iconCreateFunction: turbineClusterIcon })
				: L.esri.featureLayer({ url, pointToLayer: pointStyle, attribution });
		});
		return L.layerGroup(sublayers);
	}

	function createContentPanes(mapInstance) {
		mapInstance.createPane('dataPane');
		mapInstance.getPane('dataPane').style.zIndex = 450;

		mapInstance.createPane('lakesPane');
		mapInstance.getPane('lakesPane').style.zIndex = 460;

		mapInstance.createPane('turbinePane');
		mapInstance.getPane('turbinePane').style.zIndex = 550;

		mapInstance.createPane('userDataPane');
		mapInstance.getPane('userDataPane').style.zIndex = 600;
	}

	function wireMapViewSync() {
		const historicalMapPaneEl = historicalMap.getPane('mapPane');
		const futureMapPaneEl = futureMap.getPane('mapPane');

		function mirrorPanTransform() {
			futureMapPaneEl.style.transform = historicalMapPaneEl.style.transform;
			futureMapPaneEl.style.left = historicalMapPaneEl.style.left;
			futureMapPaneEl.style.top = historicalMapPaneEl.style.top;
		}

		function syncFutureViewFully() {
			futureMap.setView(historicalMap.getCenter(), historicalMap.getZoom(), { animate: false });
		}

		historicalMap.on('move', mirrorPanTransform);
		historicalMap.on('zoom', syncFutureViewFully);
		historicalMap.on('moveend', syncFutureViewFully);
		historicalMap.on('zoomend', syncFutureViewFully);
	}

	function enforceMapBounds() {
		if (!CONFIG.map.maxBounds) return;
		const allowedBounds = L.latLngBounds(CONFIG.map.maxBounds);
		historicalMap.panInsideBounds(allowedBounds, { animate: false });
	}

	function buildMapAttributionHtml() {
		const turbineCredit =
			'Canadian Wind Turbine Database sourced from ' +
			`<a href="${CONFIG.turbines.creditUrl}" target="_blank" rel="noopener">Natural Resources Canada</a>`;
		return [CONFIG.basemap.attribution, CONFIG.citationHtml, turbineCredit].join(' | ');
	}

	function createOneMap(containerEl, isInteractive) {
		return L.map(containerEl, {
			center: CONFIG.map.center,
			zoom: CONFIG.map.zoom,
			minZoom: CONFIG.map.minZoom,
			maxZoom: CONFIG.map.maxZoom,
			zoomSnap: CONFIG.map.zoomSnap,
			zoomDelta: CONFIG.map.zoomDelta,
			zoomControl: isInteractive,
			attributionControl: false,
			zoomAnimation: false,
			dragging: isInteractive,
			touchZoom: isInteractive,
			scrollWheelZoom: isInteractive,
			doubleClickZoom: isInteractive,
			boxZoom: isInteractive,
			keyboard: isInteractive,
			tap: isInteractive,
		});
	}

	function initMap() {
		historicalMap = createOneMap(historicalMapContainerEl, true);
		futureMap = createOneMap(futureMapContainerEl, false);

		for (const oneMap of [historicalMap, futureMap]) {
			L.tileLayer(CONFIG.basemap.tileUrl, {
				maxZoom: CONFIG.basemap.maxZoom,
				subdomains: 'abcd',
			}).addTo(oneMap);
			createContentPanes(oneMap);
			addNonCanadaMask(oneMap);
			addGreatLakesOutline(oneMap);
		}
		mapAttributionEl.innerHTML = buildMapAttributionHtml();

		turbineLayers.historical = buildTurbineLayer();
		turbineLayers.future = buildTurbineLayer();

		historicalMap.addControl(buildInfoControl());
		historicalMap.addControl(buildAddLayerControl());

		wireMapViewSync();

		mapsReady = true;
		applyDividerPosition(state.dividerPercent);
		positionZoomControl();
		reloadMapLayers();

		if (turbineToggleEl.checked) {
			setTurbinesVisible(true);
		}

		window.addEventListener('resize', positionZoomControl);

		historicalMap.on('moveend', enforceMapBounds);
		historicalMap.on('zoomend', enforceMapBounds);
	}

	try {
		initMap();
	} catch (err) {
		showError(
			`Map failed to initialize: ${err.message}. The season/layer/threshold controls above will still ` +
				'update once this is fixed, but nothing will render on the map until the page is reloaded.'
		);
	}
})();