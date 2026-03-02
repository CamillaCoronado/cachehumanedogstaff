/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	theme: {
		extend: {
			colors: {
				brand: {
					50: '#eff8f6',
					100: '#d7efe9',
					200: '#b1e0d7',
					300: '#7cc8be',
					400: '#46aa9f',
					500: '#2a9085',
					600: '#1f7169',
					700: '#1c5b55',
					800: '#1b4a45',
					900: '#173c39'
				},
				ink: {
					50: '#f2f5f9',
					100: '#e3e9f2',
					200: '#c0cddd',
					300: '#95a9c2',
					400: '#6b86a7',
					500: '#4e6b8b',
					600: '#3f546f',
					700: '#324358',
					800: '#293747',
					900: '#1d2732'
				}
			},
			boxShadow: {
				card: '0 12px 32px rgba(15, 32, 39, 0.12)'
			},
			borderRadius: {
				xl: '1.25rem'
			}
		}
	},
	plugins: []
};
