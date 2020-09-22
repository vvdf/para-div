import axios from 'axios';
import io from 'socket.io-client';
import GameMap from './GameMap';
import Entity from './Entity';
import Input from './Input';
import EventQueue from './EventQueue';
import Renderer from './Renderer';

class Engine {
  constructor(targetEle) {
    // initialize game renderer, append as child to passed in element
    this.settings = {
      backgroundColor: 0xf0c5e9,
      width: 800,
      height: 550,
      resolution: 1,
    };

    this.constants = {
      // these include pixel overlap
      tileWidth: 28,
      tileHeight: 14,
      tileDepth: 10,
    };

    this.state = this.play;
    this.eventQueue = new EventQueue();
    this.entities = [];
    this.entityNextId = 0;
    this.entityIdMap = {};
    this.gameMap = new GameMap(40, 40, 'w');
    this.gameMap.load();
    this.input = new Input(this.eventQueue);
    this.renderer = new Renderer(this.settings, this.constants, this.entities, this.gameMap);
    targetEle.appendChild(this.renderer.getView());
    this.renderer.setup()
      .then(() => this.init());
  }

  init() {
    // initialize game Engine variables/systems/assets
    this.createEntity('Camera', 'blank'); // create game camera as focus entity
    this.createEntity(`Apron${Math.floor(Math.random() * 1000)}`, 'player'); // create player entity
    axios.get('/entity')
      .then((response) => {
        if (response.data[0] && response.data[0].x && response.data[0].y) {
          console.log('TOTAL ENTITIES RECEIVED: ', response.data.length);
          this.entities[1].setPos(response.data[0].x, response.data[0].y);
          this.centerCamera(false);
        } else {
          axios.post('/entity', { ...this.entities[1], map: null });
        }
        for (let i = 1; i < response.data.length; i += 1) {
          console.log(response.data[i]);
          const { name, x, y } = response.data[i];
          this.createEntity(name, 'player', x, y);
        }
      })
      .then(() => {
        // initialize game loop and perform first render
        // after initialization of player/camera/etc
        console.log('INIT GAME LOOP + FIRST RENDER');
        this.renderer.addToTicker((delta) => this.gameLoop(delta));
        this.renderer.render();
      });

    this.socket = io('127.0.0.1:3001');
    this.socket.emit('serverLog', 'data of random text');
    this.socket.on('connect', () => {
      console.log('Socket Connected on Client Side');
    });
    this.socket.on('gameEvent', (data) => {
      console.log('GameEvent received via sockets: ', data);
    });

    // define events for EventQueue/Reducer
    this.eventQueue.defineEvent('MOVE_ENTITY',
      (entityId, dx = 0, dy = 0) => {
        this.entityIdMap[entityId].move(dx, dy);
        if (entityId === 1) {
          // if entity moved is player, move camera also
          this.entityIdMap[0].move(dx, dy);
          this.socket.emit('serverLog', `MOVED ${dx}, ${dy}`);
        }
      });

    this.eventQueue.defineEvent('PAINT_MAP',
      (entityId, tile) => {
        this.gameMap.set(this.entityIdMap[entityId].x, this.entityIdMap[entityId].y, tile);
        this.renderer.render();
      });
  }

  gameLoop(delta) {
    this.state(delta);
  }

  play(delta) {
    // play state function
    if (this.eventQueue.length > 0) {
      this.eventQueue.next(delta);
      if (this.entities.length > 2) {
        console.log('ENTITY COUNT: ', this.entities.length);
      }
      // console.log('EVENT COUNT: ', this.eventQueue.length);
      if (this.eventQueue.length < 1) {
        // if event queue is emptied, ie all potential state change is computed, re-render
        this.renderer.update();
      }
    }
  }

  createEntity(name, textureKey, x = 0, y = 0, map = this.gameMap) {
    const id = this.entityNextId;
    this.entityNextId += 1;
    const createdEntity = new Entity(name, textureKey, x, y, map, id);
    this.renderer.updateEntitySprite(id, textureKey);
    if (id === 1) {
      // establishing player as id 1, as camera is 0
      this.input.setOwner(createdEntity);
    }
    this.entities.push(createdEntity);
    this.entityIdMap[id] = createdEntity;
  }

  updateEntities(entityArr) {
    // TODO - populate this with proper code
    // this.entities = this.entities.slice(0, 2);
    // for (let i = 1; i < entityArr.length; i += 1) {
    //   const {
    //     name,
    //     textureKey,
    //     x,
    //     y,
    //   } = entityArr[i];
    //   this.createEntity(name, textureKey, x, y);
    // }
    // this.renderer.render();
  }

  centerCamera(updateView = true) {
    this.entities[0].setPos(this.entities[1].x, this.entities[1].y);
    if (updateView) {
      this.renderer.update();
    }
  }
}

export default Engine;
