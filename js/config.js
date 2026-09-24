const CONFIG = {
	map: {
		center: [58.0, -95.0],
		zoom: 4,
		maxZoom: 7,
		minZoom: 3,

		// zoomanimation turned off (createOneMap() in js/app.js)
		zoomSnap: 0.125,
		zoomDelta: 0.125,

		maxBounds: [
			[-10, -170],
			[85, 40],
		],
	},

	basemap: {
		tileUrl: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=cb1_2ym7_1_08175eae82427a7d93624d47',
		attribution:
			'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
			'&copy; <a href="https://carto.com/attributions">CARTO</a>',
		maxZoom: 19,
	},

	// mask everything but Canada, add in Great Lakes outline
	nonCanadaMaskColor: '#888888',
	nonCanadaMaskOpacity: 0.55,

	countriesGeoJsonUrl: 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson',

	greatLakesGeoJsonUrl: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_lakes.geojson',

	// live link to NRCan turbine database
	turbines: {
		restBaseUrl: 'https://maps-cartes.services.geo.ca/server_serveur/rest/services/NRCan/wind_turbine_database2_en/MapServer',
		layerIds: Array.from({ length: 14 }, (_, i) => i), // [0, 1, 2, ..., 13]
		creditUrl: 'https://open.canada.ca/data/en/dataset/79fdad93-9025-49ad-ba16-c26d718cc070',
	},

	// geojsons of the actual data
	dataPaths: {
		speed: (height, season, period) =>
			`data/speed/wind_speed_bands_${height}_${season}_${period}.geojson`,
		shear: (season, period) =>
			`data/shear/wind_shear_bands_${season}_${period}.geojson`,
	},

	seasonsByHeight: {
		Z1: ['ANNUAL', 'DJF', 'MAM', 'JJA', 'SON'],
		ZHUB: ['ANNUAL', 'DJF', 'MAM', 'JJA', 'SON'],
		Z2: ['ANNUAL', 'DJF', 'MAM', 'JJA', 'SON'],
	},

	thresholds: {
		speed: {
			min: 0,
			max: 15,
			step: 1,
			default: 7,
			relation: 'gte',
			label: (v) => `Highlight cells with mean wind speed \u2265 ${v} m/s`,
		},
		shear: {
			min: 0.0,
			max: 0.80,
			step: 0.05,
			default: 0.35,
			relation: 'lte',
			label: (v) => `Highlight cells with shear exponent \u2264 ${Number(v).toFixed(2)}`,
		},
	},

	// layer desc
	speedHeightDetails: {
		Z1: 'Z1: 992.6 hPa, ~59.8 m AGL.',
		ZHUB: 'ZHUB: interpolated height \u2014 not a raw model output, ~126.4 m AGL.',
		Z2: 'Z2: 976.3 hPa, ~192.9 m AGL.',
	},

	style: {
		highlighted: { color: '#4daf4a', weight: 0, fillColor: '#4daf4a', fillOpacity: 0.75 },
		dimmed: { color: '#777777', weight: 0, fillColor: '#bbbbbb', fillOpacity: 0.25 },
		outerBoundary: { color: '#333333', weight: 1.5, fill: false },
		greatLakesOutline: { color: '#333333', weight: 1.5, fill: false },
	},

	// from colorbrewer
	combinedCompliance: {
		speedOnlyColor: '#e41a1c',
		shearOnlyColor: '#377eb8',
		bothColor: '#4daf4a',
		fillOpacity: 0.75,
	},
    // dont show terms of use again if check box selected 
	disclaimerStorageKey: 'wcr_disclaimer_dismissed',

	citationHtml:
		'VR-CESM simulations were conducted by Morris et al. (<a href="https://doi.org/10.1175/JCLI-D-22-0719.1">2023</a>, ' +
		'<a href="https://doi.org/10.1175/JCLI-D-23-0547.1">2024</a>) and Morris &amp; Kushner ' +
		'(<a href="https://doi.org/10.1175/JCLI-D-24-0532.1">2025</a>). Simulations were regridded by Lucas Prates ' +
		'| Web viewer created by Alex Torrealba',
};