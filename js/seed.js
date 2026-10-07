// Seed data: ~200 surge calls (NYC), 8 units, and pre-existing P3/P4 incidents.
// `t` = seconds into the 2-minute replay at which the call arrives.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Seed = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  let s = 311;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const channels = ['phone', 'phone', 'phone', 'sms', 'app', 'web'];
  function jitter(lat, lng, m) {
    const r = m * Math.sqrt(rnd()), a = rnd() * 2 * Math.PI;
    return [lat + (r * Math.cos(a)) / 111320, lng + (r * Math.sin(a)) / (111320 * Math.cos((lat * Math.PI) / 180))];
  }
  const calls = [];
  function add(t, text, lat, lng, address, m = 30, channel) {
    const [la, ln] = jitter(lat, lng, m);
    calls.push({ t: +t.toFixed(1), raw_text: text, lat: +la.toFixed(6), lng: +ln.toFixed(6), address, channel: channel || pick(channels), scenario: null });
    return calls[calls.length - 1];
  }

  // ---- 1. BQE multi-car crash: 25 callers. #8 adds fire, #14 adds person trapped → P2 → P1 → P0.
  const BQE = [40.6936, -73.9972, 'BQE southbound near Atlantic Ave exit, Brooklyn'];
  const bqe = [
    'Multi-car crash on the BQE by the Atlantic Ave exit, one of the drivers is trying to drive off',
    'Big pileup on the BQE southbound, like 4 cars smashed together',
    'Car accident on the BQE near Atlantic, traffic completely stopped',
    'There was a crash on the BQE, a guy got out and ran off toward Hicks St',
    'Collision on the BQE, several cars, glass everywhere',
    'Calling about the crash on the BQE, people are out of their cars',
    'Pileup on the expressway BQE southbound, multiple cars involved',
    'The crash on the BQE, one of the cars is on fire now, lots of black smoke',
    'Accident on the BQE, I can see smoke from my window',
    'BQE crash near Atlantic Ave, cars are blocking all lanes',
    'Reporting a car accident on the BQE, looks bad',
    'Multi car crash BQE, a driver took off on foot',
    'Crash on the BQE, traffic backed up to the bridge',
    'BQE crash, there is a person trapped in the blue car, they can\'t get out',
    'Pile-up on the BQE southbound, still people in the cars',
    'Car accident on the BQE, there\'s fire and smoke coming from one car',
    'Crash on the BQE by Atlantic, someone is pinned in a vehicle',
    'Accident on the BQE, I\'m stuck in traffic behind it',
    'BQE collision, 4 cars, please send help',
    'The BQE crash, still someone trapped and the car is burning',
    'Wreck on the BQE, people are trying to help the driver',
    'Crash on the BQE near the Atlantic Ave exit, it\'s chaos',
    'Car accident BQE southbound, lanes blocked',
    'Calling again about the BQE crash, the fire is getting bigger',
    'Crash on the BQE, there\'s smoke everywhere',
  ];
  bqe.forEach((txt, i) => { add(4 + i * 3.6, txt, BQE[0], BQE[1], BQE[2], 60, i === 7 || i === 13 ? 'phone' : undefined).scenario = 'bqe'; });

  // ---- 2. Washington Heights water main break, reported as 4 different complaint types.
  const WH = [40.8497, -73.9360];
  const wh = [
    [8, 'We have no water in our apartment on W 181st St, the taps are dry', 'W 181st St & St Nicholas Ave, Manhattan', [40.8496, -73.9357]],
    [15, 'The street is flooding on St Nicholas Ave, water gushing up from the road', 'St Nicholas Ave & W 180th St, Manhattan', [40.8488, -73.9372]],
    [22, 'Water pressure in my shower is barely a trickle', 'Audubon Ave & W 182nd St, Manhattan', [40.8510, -73.9339]],
    [30, 'There is a sinkhole opening up on W 180th St, the asphalt is caving in', 'W 180th St & Wadsworth Ave, Manhattan', [40.8482, -73.9351]],
    [38, 'No running water in the whole building since this morning, 181st street', 'W 181st St & Audubon Ave, Manhattan', [40.8502, -73.9344]],
    [47, 'Flooding at St Nicholas and 180th, water rushing into the subway entrance', 'St Nicholas Ave & W 180th St, Manhattan', [40.8486, -73.9370]],
    [55, 'Low water pressure in our building, kitchen sink is weak', 'W 182nd St & St Nicholas Ave, Manhattan', [40.8507, -73.9365]],
    [63, 'Water is off in my apartment, nothing comes out, building on Wadsworth', 'Wadsworth Ave & W 181st St, Manhattan', [40.8494, -73.9349]],
    [72, 'Street flooded near the 181 St station, cars driving through water', 'St Nicholas Ave & W 181st St, Manhattan', [40.8495, -73.9368]],
    [80, 'Sinkhole on 180th getting bigger, a cone fell in', 'W 180th St & Wadsworth Ave, Manhattan', [40.8483, -73.9353]],
    [88, 'Pressure dropped to almost nothing in my faucet', 'Audubon Ave & W 181st St, Manhattan', [40.8504, -73.9342]],
    [96, 'Still no water on 181st, dry faucets in every unit', 'W 181st St & St Nicholas Ave, Manhattan', [40.8497, -73.9360]],
    [104, 'Water bubbling up out of the street on St Nicholas', 'St Nicholas Ave & W 180th St, Manhattan', [40.8489, -73.9373]],
  ];
  wh.forEach(([t, txt, addr, [la, ln]]) => { add(t, txt, la, ln, addr, 15).scenario = 'water'; });
  void WH;

  // ---- 3. Bronx shots fired. First call is P1 (weapon) → preemption; then P0 (person shot).
  const BX = [40.8336, -73.8606, 'White Plains Rd & Westchester Ave, Bronx'];
  [
    [52, 'Shots fired near White Plains Rd and Westchester Ave, heard like 5 gunshots'],
    [55, 'I heard gunshots by the Westchester Ave train station'],
    [58, 'Someone got shot, he is bleeding on the sidewalk, the shooter ran toward the train'],
    [62, 'Shots fired on White Plains Road, people running'],
    [66, 'Shooting near Westchester Ave, a man is down and bleeding'],
    [71, 'Heard shots, the guy with the gun took off on a bike'],
    [77, 'Gunshots by the elevated train on White Plains Rd'],
  ].forEach(([t, txt]) => { add(t, txt, BX[0], BX[1], BX[2], 120).scenario = 'shots'; });

  // ---- 4. Astoria kitchen fire that later reports "fire is out" → downgrade needs dispatcher approval.
  const AS = [40.7614, -73.9196, '31-10 Steinway St, Astoria, Queens'];
  [
    [18, 'Kitchen fire, smoke coming out of a 3rd floor window on Steinway St'],
    [21, 'Fire on Steinway St, I can see flames from the apartment'],
    [26, 'There is a fire in the building on Steinway, smoke in the hallway'],
    [108, 'Update on the Steinway St fire: the fire is out, everyone is safe'],
  ].forEach(([t, txt]) => { add(t, txt, AS[0], AS[1], AS[2], 40).scenario = 'fire'; });

  // ---- 5. Noise hotspots (group into a few incidents each).
  const noiseSpots = [
    [40.7265, -73.9815, '200 E 7th St, Manhattan'],
    [40.7145, -73.9614, 'N 7th St & Berry St, Brooklyn'],
    [40.6872, -73.9418, 'Halsey St & Throop Ave, Brooklyn'],
    [40.7685, -73.9550, 'E 75th St & 1st Ave, Manhattan'],
    [40.8160, -73.9440, 'W 135th St & Lenox Ave, Manhattan'],
    [40.7440, -73.9200, 'Queens Blvd & 43rd St, Queens'],
    [40.6340, -73.9640, 'Cortelyou Rd & E 16th St, Brooklyn'],
    [40.8425, -73.8620, 'Castle Hill Ave & Parker St, Bronx'],
    [40.7590, -73.8300, 'Main St & 41st Ave, Flushing, Queens'],
    [40.7810, -73.9800, 'W 72nd St & Amsterdam Ave, Manhattan'],
    [40.6780, -73.9810, '5th Ave & Union St, Brooklyn'],
    [40.8505, -73.9330, 'Audubon Ave & W 184th St, Manhattan'],
  ];
  const noiseText = [
    'Loud party with music blasting at {a}, it is 1am',
    'Neighbors playing really loud music at {a}, can hear the bass through the walls',
    'Noise complaint, a party on the roof at {a}',
    'Loud music coming from the apartment at {a}, been going for hours',
    'Someone blasting music from a car outside {a}',
    'Party noise at {a}, people yelling and loud music',
  ];
  noiseSpots.forEach(([la, ln, a]) => {
    const n = 4 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) add(rnd() * 118, pick(noiseText).replace('{a}', a), la, ln, a, 35);
  });

  // ---- 6. Illegal parking hotspots.
  const parkSpots = [
    [40.6810, -73.9750, '120 Prospect Pl, Brooklyn'],
    [40.7210, -73.9880, 'Orchard St & Rivington St, Manhattan'],
    [40.7470, -73.8900, '37th Ave & 74th St, Jackson Heights, Queens'],
    [40.6620, -73.9530, 'Lefferts Ave & Rogers Ave, Brooklyn'],
    [40.8620, -73.9030, 'Grand Concourse & E Fordham Rd, Bronx'],
    [40.7920, -73.9720, 'W 95th St & Broadway, Manhattan'],
    [40.7010, -73.9900, 'Old Fulton St & Front St, Brooklyn'],
    [40.7280, -73.9520, 'Manhattan Ave & Greenpoint Ave, Brooklyn'],
  ];
  const parkText = [
    'A car is blocking my driveway at {a}',
    'Car parked in my driveway at {a}, I can\'t get out',
    'Illegally parked car blocking the driveway at {a}',
    'Truck double parked blocking the street at {a}',
    'Someone parked in the bike lane at {a} again',
  ];
  parkSpots.forEach(([la, ln, a]) => {
    const n = 3 + Math.floor(rnd() * 3);
    const base = pick(parkText);
    for (let i = 0; i < n; i++) add(rnd() * 118, (i === 0 ? base : pick(parkText)).replace('{a}', a), la, ln, a, 25);
  });

  // ---- 7. Cold thefts (report-only, P4). A few at the same building group together.
  const theftText = [
    'My bike was stolen from outside my building last night at {a}',
    'Someone broke into my car yesterday at {a} and took my laptop',
    'Package stolen from the lobby at {a} two days ago',
    'My scooter was stolen from the rack at {a} this morning',
    'Came back to find my catalytic converter stolen, parked at {a} last night',
    'Someone stole my wallet at {a} yesterday, I need a report for insurance',
  ];
  const theftSpots = [
    [40.7410, -73.9890, '30 W 23rd St, Manhattan'], [40.6890, -73.9820, 'Fulton Mall, Brooklyn'],
    [40.7580, -73.9850, '7th Ave & W 46th St, Manhattan'], [40.7040, -73.9300, 'Flushing Ave & Bushwick Ave, Brooklyn'],
    [40.7490, -73.9420, 'Jackson Ave & 23rd St, Long Island City'], [40.8210, -73.9500, 'W 141st St & Broadway, Manhattan'],
    [40.6500, -73.9500, 'Flatbush Ave & Church Ave, Brooklyn'], [40.7700, -73.9100, '31st St & Ditmars Blvd, Astoria'],
    [40.8150, -73.9180, 'E 149th St & 3rd Ave, Bronx'], [40.7310, -74.0010, 'Bleecker St & 6th Ave, Manhattan'],
    [40.5800, -73.9600, 'Brighton Beach Ave, Brooklyn'], [40.7060, -74.0090, 'Wall St & William St, Manhattan'],
  ];
  for (let i = 0; i < 36; i++) {
    const [la, ln, a] = pick(theftSpots);
    add(rnd() * 118, pick(theftText).replace('{a}', a), la, ln, a, 30);
  }
  // Repeat package thefts in one building → grouped + deflectable.
  for (let i = 0; i < 4; i++) add(10 + i * 25, 'Another package stolen from the lobby at 455 Ocean Pkwy, this happened yesterday', 40.6400, -73.9720, '455 Ocean Pkwy, Brooklyn', 10);

  // ---- 8. Misc singles (medical, fights, inquiries, unclassified).
  [
    [12, 'My grandmother is not breathing, please hurry', 40.7180, -73.9570, '250 Bedford Ave, Brooklyn'],
    [33, 'Two guys fighting outside the bar, one of them has a knife', 40.7230, -73.9880, 'Ludlow St & Stanton St, Manhattan'],
    [44, 'Elderly man fell on the sidewalk, he is conscious but can\'t get up', 40.7860, -73.9510, 'Lexington Ave & E 96th St, Manhattan'],
    [69, 'I have a question about my property tax bill', 40.7130, -74.0060, 'Brooklyn'],
    [74, 'How do I get a permit for a block party', 40.6850, -73.9440, 'Brooklyn'],
    [83, 'uh hello? hello? can you hear me', 40.7300, -73.9350, 'Unknown'],
    [91, 'Man unconscious on the subway platform at 14th St', 40.7378, -73.9966, '14th St & 6th Ave, Manhattan'],
    [99, 'My car was rear-ended at a red light, no one is hurt, the other driver is still here', 40.7510, -73.9770, 'Lexington Ave & E 42nd St, Manhattan'],
    [113, 'There is a kid crying for help in the building at 88 Clinton St', 40.7170, -73.9860, '88 Clinton St, Manhattan'],
  ].forEach(([t, txt, la, ln, a]) => add(t, txt, la, ln, a, 10));

  calls.sort((a, b) => a.t - b.t);

  // ---- Units and pre-existing incidents.
  const preIncidents = [
    { key: 'pre-bx-noise', category: 'noise', lat: 40.8389, lng: -73.8658, address: 'Westchester Ave & Pugsley Ave, Bronx', minutesAgo: 40,
      raw_text: 'Loud music from a block party on Westchester Ave, been going for hours', calls: 3 },
    { key: 'pre-bk-park', category: 'illegal parking', lat: 40.6905, lng: -73.9935, address: 'Atlantic Ave & Henry St, Brooklyn', minutesAgo: 35,
      raw_text: 'Car blocking my driveway on Atlantic Ave at Henry St', calls: 2 },
    { key: 'pre-wh-noise', category: 'noise', lat: 40.8530, lng: -73.9310, address: 'W 186th St & Audubon Ave, Manhattan', minutesAgo: 50,
      raw_text: 'Loud music and a party in the courtyard at W 186th St', calls: 4 },
  ];
  const units = [
    { id: 'U1', name: 'Unit 1', lat: 40.7550, lng: -73.9860, status: 'available', assigned_incident_key: null },
    { id: 'U2', name: 'Unit 2', lat: 40.6905, lng: -73.9930, status: 'on_scene', assigned_incident_key: 'pre-bk-park' },
    { id: 'U3', name: 'Unit 3', lat: 40.8530, lng: -73.9312, status: 'on_scene', assigned_incident_key: 'pre-wh-noise' },
    { id: 'U4', name: 'Unit 4', lat: 40.8389, lng: -73.8655, status: 'on_scene', assigned_incident_key: 'pre-bx-noise' },
    { id: 'U5', name: 'Unit 5', lat: 40.7150, lng: -73.9580, status: 'available', assigned_incident_key: null },
    { id: 'U6', name: 'Unit 6', lat: 40.7450, lng: -73.9050, status: 'available', assigned_incident_key: null },
    { id: 'U7', name: 'Unit 7', lat: 40.8200, lng: -73.9450, status: 'available', assigned_incident_key: null },
    { id: 'U8', name: 'Unit 8', lat: 40.6600, lng: -73.9600, status: 'available', assigned_incident_key: null },
  ];

  // Addresses offered in the Call Simulator.
  const addresses = [
    { label: 'W 186th St & Audubon Ave, Manhattan (existing noise incident)', lat: 40.8530, lng: -73.9310 },
    { label: 'Atlantic Ave & Henry St, Brooklyn (existing parking incident)', lat: 40.6905, lng: -73.9935 },
    { label: 'BQE southbound near Atlantic Ave exit, Brooklyn', lat: 40.6936, lng: -73.9972 },
    { label: 'W 181st St & St Nicholas Ave, Manhattan', lat: 40.8497, lng: -73.9360 },
    { label: 'White Plains Rd & Westchester Ave, Bronx', lat: 40.8336, lng: -73.8606 },
    { label: '200 E 7th St, Manhattan', lat: 40.7265, lng: -73.9815 },
    { label: '455 Ocean Pkwy, Brooklyn', lat: 40.6400, lng: -73.9720 },
    { label: 'Times Square, Manhattan', lat: 40.7580, lng: -73.9855 },
  ];

  return { calls, units, preIncidents, addresses };
});
