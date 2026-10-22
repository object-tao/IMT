# GeoNames reference data

The full populated-place database is installed here as `world.sqlite`. Generated databases and archives are not committed. Run `npm run geo:sync` to install the pinned snapshot described in `manifest.json`.

Data by [GeoNames](https://www.geonames.org/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Built from [allCountries.zip, countryInfo.txt and admin1CodesASCII.txt](https://download.geonames.org/export/dump/). Includes all feature-class P populated-place records with a recognized source country, without a population cutoff. GeoNames does not guarantee absolute accuracy, currency or completeness.

Country labels use ICU/Unicode CLDR via `Intl.DisplayNames`. City labels preserve the GeoNames main name, avoiding arbitrary translations or nicknames. Chinese names and other aliases remain searchable where provided by the source. Administrative regions and stable place IDs distinguish same-name cities.
