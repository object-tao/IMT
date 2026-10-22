import { airportNode } from '../shared/model.js';
import { airFixture } from './air-fixture.js';

// A known flight ends in Prague; no Paris node or onward road supplier exists.
export function roadConnectionFixture() {
  const { catalog, request, flight } = airFixture();
  catalog.suppliers = catalog.suppliers.map(supplier => ({ ...supplier, id: `road-connection-${supplier.id}` }));
  catalog.airports = catalog.airports.map(airport => ({ ...airport, id: `road-connection-${airport.id}` }));
  catalog.nodes = catalog.airports.map(airportNode);
  catalog.lanes = catalog.lanes.filter(lane => lane.mode === 'air').map(lane => ({
    ...lane, id: `road-connection-${lane.id}`, supplierId: catalog.suppliers[0].id,
    from: catalog.airports[0].id, to: catalog.airports[1].id,
    fromAirportId: catalog.airports[0].id, toAirportId: catalog.airports[1].id,
  }));
  catalog.flights = [{ ...flight, id: `road-connection-${flight.id}`, laneId: catalog.lanes[0].id }];
  return {
    catalog,
    request: { ...request, destinationCountry: 'FR', destinationCity: 'Paris', destinationCityId: '2988507' },
    roadSelection: `road-gap|${catalog.airports[1].id}|__destination__`,
    flightSelection: `flight|${catalog.lanes[0].id}|${catalog.flights[0].id}`,
  };
}
