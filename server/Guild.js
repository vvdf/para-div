const GameMap = require('./GameMap');
const Entity = require('./Entity');
const { generateID, generateName } = require('./utility');

class Guild {
  constructor(location) {
    this.name = `${location} ${generateName()}`;
    this.location = location;
    this.seed = ""; // generate on guild creation to allow consistency of procgen
    this.members = {}; // eid : entity
    this.maps = {}; // list of open maps from the guild's players
    // TODO - add progression info, stuff like guild level/rank/research tree/etc

    console.log(this.name, ' GUILD CREATED');
  }

  newMember(name) {
    const nextMember = new Entity(name);
    this.members[nextMember.eid] = nextMember;
    return nextMember;
  }

  removeMember(eid) {
    delete this.members[eid];
  }

  newMap(eid) {
    const mapId = `MID${generateID()}`;
    this.maps[mapId] = new GameMap(mapId);
    this.maps[mapId].addEntity(this.members[eid]);
  }

  closeMap() {
    
  }

  getMap(eid) {
    // get ref to actual map object without parsing for client
    return this.maps[this.members[eid].getMap()];
  }

  getMapObj(eid) {
    // takes eid and returns the map they're on
    return this.maps[this.members[eid].getMap()].getMapObj();
  }

  getMember(eid) {
    return this.members[eid];
  }
}

module.exports = Guild;