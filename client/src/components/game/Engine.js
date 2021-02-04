import axios from 'axios';
import GameMap from './GameMap';
import Entity from './Entity';
import Input from './Input';
import EventQueue from './EventQueue';
import Renderer from './Renderer';
import SocketInterface from './SocketInterface';
import UI from './UI';

class Engine {
  constructor(targetEle) {
    // initialize game renderer, append as child to passed in element
    this.settings = {
      backgroundColor: 0x030305,
      width: 800,
      height: 600,
      resolution: 1,
    };

    this.constants = {
      // these include pixel overlap
      tileWidth: 28,
      tileHeight: 14,
      tileDepth: 10,
    };

    this.userID = '';
    this.state = this.startGame;
    this.eventQueue = new EventQueue();
    this.entities = [];
    this.playerEntity = {};
    this.entityIdMap = {};
    this.messageLog = {}; // TODO - build a proper module handling message I/O (likely part of UI?)
    this.currentMap = 'world';
    this.gameMap = new GameMap();
    this.input = new Input(this.eventQueue);
    this.ui = new UI();
    this.sio = false; // socket interface, to be defined during initialization
    this.renderer = new Renderer(
      this.settings,
      this.constants,
      this.entities,
      this.gameMap,
      this.ui,
      this.messageLog,
    );
    this.flagRerender = false;
    targetEle.appendChild(this.renderer.getView()); // attach PIXI app to html element
    this.createEntity({ eid: 0, name: 'Camera', textureKey: 'blank' }); // instantiate camera
    this.renderer.setup()
      .then(() => this.initEvents())
      .then(() => this.renderer.addToTicker((delta) => this.gameLoop(delta)));
  }

  initEvents() {
    // define events for EventQueue/Reducer
    this.eventQueue.defineEvent('MOVE_ENTITY',
      (eid, dx = 0, dy = 0) => {
        // test to determine if target cell is movable before processing at all
        const moveIsValid = this.gameMap.isWalkable(this.entityIdMap[eid].nextPos(dx, dy));
        if (moveIsValid) {
          this.entityIdMap[eid].move(dx, dy);
          if (eid === this.entities[1].eid) {
            // if entity moved is player, move camera also
            // restrict movement, no need to broadcast 'attempts' at moving into a wall
            this.entityIdMap[0].move(dx, dy);
            this.sio.emit('gameEvent', { signal: 'MOVE_ENTITY', params: [eid, dx, dy] });
          }
        } else {
          // console.log('move is invalid');
        }
      });

    this.eventQueue.defineEvent('MOVE_TO',
      (eid, x, y) => {
        const moveIsValid = this.gameMap.isWalkable(this.entityIdMap[eid].nextPos(x, y));
        if (moveIsValid) {
          this.entityIdMap[eid].setPos(x, y);
        } else {
          console.log('move_to call points to invalid cell');
        }
      });

    this.eventQueue.defineEvent('NEW_ENTITY',
      (eid, name, textureKey, pos) => {
        if (this.entityIdMap[eid]) {
          // if entity still exists in local storage
          console.log('Add Entity attempted, updating');
          this.entityIdMap[eid].setPosObj(pos);
        } else {
          // otherwise add new entity
          console.log('Adding Entity', pos);
          this.createEntity({ eid, name, textureKey, pos });
          this.flagRerender = true;
        }
      });

    this.eventQueue.defineEvent('DEBUG_MSG', (msg) => {
      console.log('DEBUG: PRINTING ENTITY LIST');
      console.log(this.entities);
    });

    this.eventQueue.defineEvent('TOGGLE_UI', () => {
      this.ui.hidden = !this.ui.hidden;
      if (this.ui.hidden) {
        this.renderer.animate(['ui'], 'fadeOut', 50);
      } else {
        this.renderer.animate(['ui'], 'fadeIn', 50);
      }
    });

    this.eventQueue.defineEvent('UI_SELECT', (input) => {
      if (input === 2) {
        this.ui.next();
      } else if (input === 1) {
        this.ui.prev();
      } else {
        this.ui.select();
      }
    });

    this.eventQueue.defineEvent('UI_INPUT', (input) => {
      if (typeof input === 'string') {
        this.ui.add(input);
        this.messageLog.consoleInput = this.ui.getText();
      } else if (input === 1) {
        this.ui.prev();
      } else if (input === 2) {
        this.ui.next();
      } else if (input === -1) {
        this.ui.delete();
        this.messageLog.consoleInput = this.ui.getText();
      } else {
        this.ui.select();
      }
    });

    this.eventQueue.defineEvent('UPDATE_ENTITY', (eid) => {
      // get updated stats and position for an entity
    });

    this.eventQueue.defineEvent('RERENDER', (input) => {
      console.log('Rerender Flag Set');
      this.flagRerender = true;
    });
  }

  gameLoop(delta) {
    this.state(delta);
  }

  // ----------------------------------
  // game states
  // ----------------------------------
  play(delta) {
    // play state function
    if (this.eventQueue.length > 0) {
      this.eventQueue.next(delta);
      // console.log('EVENT COUNT: ', this.eventQueue.length);
      if (this.eventQueue.length < 1) {
        // if event queue is emptied, ie all potential state change is computed, re-render
        if (this.flagRerender) {
          // rerender then clear flag until flag is set/called again
          // console.log('Play State: Rerendering');
          this.renderer.render();
          this.flagRerender = false;
        } else {
          // console.log('Play State: Updating');
          this.renderer.update();
        }
      }
    }
  }

  startGame(delta) {
    // determine if game is loading or enters main menu
    axios.get('/user')
      .then((userData) => {
        if (userData.data.found) {
          // user id AND living entity found, jump to base menu
          axios.get('/entity')
            .then(({ data }) => {
              this.createEntity(data);
              this.currentMap = data.map;
              this.input.setOwner(this.entities[1]);
              this.sio = new SocketInterface(this.eventQueue, `${window.location.hostname}:3001`);
              if (data.map === 'world') {
                this.state = this.worldMap;
                // this.state = this.baseMenu;
              } else {
                this.state = this.fieldMode;
              }
            });
        } else {
          // user id not found, new user id assigned, go to main menu
          this.state = this.mainMenu;
        }
        this.userID = userData.userID;
      });
    this.state = this.play;
  }

  mainMenu(delta) {
    this.ui.newMenu([{
      text: 'new officer',
      onSelect: () => {
        this.state = this.characterCreation;
        this.ui.clear();
      },
    }]);
    this.renderer.clear();
    this.renderer.render();
    this.state = this.play;
  }

  characterCreation(delta) {
    let playerName = '';
    let playerAreaName = '';
    this.messageLog.consoleText = '> NEW OFFICER NAME:\n> '; // initializations
    this.messageLog.consoleInput = '';
    this.renderer.consoleRender();
    this.renderer.hide('console', 'consoleText');
    this.renderer.animate(['console', 'consoleText'], 'fadeIn', 20);
    this.input.setMode('text');
    let creationStep = 0;
    this.ui.newMenu([{
      text: 'create officer',
      onSelect: () => {
        const textLines = this.messageLog.consoleText.split('\n');
        if (textLines > 24) {
          this.messageLog.consoleText = textLines.slice(textLines.length - 24).join('\n');
        }
        let nextStepPromptText = '';

        if (this.messageLog.consoleInput.length > 0) {
          // acceptable input submitted
          if (creationStep < 1) {
            playerName = this.ui.getText();
            nextStepPromptText = `AREA WHERE OFFICER [${playerName}] IS STATIONED:\n> `;
          } else if (creationStep === 1) {
            playerAreaName = this.ui.getText();
            nextStepPromptText = `WELCOME, OFFICER [${playerName}] OF THE [${playerAreaName}] `
            + `${playerName.length + playerAreaName.length > 24 ? '\n' : ''}DIVISION`;
            this.ui.clear();
            axios.post('/entity', { name: playerName, area: playerAreaName })
              .then(() => {
                axios.get('/entity')
                  .then(({ data }) => {
                    this.createEntity(data);
                    this.currentMap = data.map;
                    this.input.setOwner(this.entities[1]);
                    this.sio = new SocketInterface(this.eventQueue, `${window.location.hostname}:3001`);
                    this.ui.clear();
                    this.ui.newMenu([{
                      text: 'start game',
                      onSelect: () => {
                        if (this.currentMap === 'world') {
                          console.log('Entering World');
                          this.state = this.worldMap;
                          // this.state = this.baseMenu;
                        } else {
                          console.log('Entering Field');
                          this.state = this.fieldMode;
                        }
                        this.ui.clear();
                      },
                    }]);
                  });
              });
          }
          creationStep += 1;
        }

        this.messageLog.consoleText = `${this.messageLog.consoleText}`
          + `${this.messageLog.consoleInput}\n> ${nextStepPromptText}`;
        this.messageLog.consoleInput = '';
        this.ui.clearInput();
      },
    }]);
    this.ui.setMode('text');
    this.state = this.play;
  }

  worldMap(delta) {
    // code to render world map before switching to base menu navigation
    // prioritized after building base menu functionality
    // TODO - come up with proper worldmap screen, possibly just base map in background
    this.renderer.setMode('field');
    this.renderer.clear();
    this.renderer.render();
    this.renderer.hide('map', 'entities', 'ui');
    // this.renderer.animate(['map', 'entities'], 'fadeIn', 100);
    this.input.setMode('field');
    this.centerCamera();
    this.state = this.baseMenu;
    // TODO - for character creation go straight to dungeon/map rather than base menu
  }

  baseMenu(delta) {
    // code to load game into base management screen
    // TODO - need to setup UI and renderer
    this.renderer.setMode('baseUI');
    // TODO - add cool scifi slide in/load animation here
    this.input.setMode('ui');
    const debugUiPrint = () => {
      console.log(this.ui.getCurrentOption());
    };
    this.ui.newMenu([
      {
        text: 'deploy',
        onSelect: () => {
          debugUiPrint();
          this.state = this.fieldMode;
          this.renderer.animate(['ui'], 'fadeOut', 200)
            .then(() => {
              this.ui.clear();
            });
        },
      },
      { text: 'case files', onSelect: () => { debugUiPrint(); } },
      { text: 'personnel', onSelect: () => { debugUiPrint(); } },
      { text: 'r&d', onSelect: () => { debugUiPrint(); } },
      { text: 'armory', onSelect: () => { debugUiPrint(); } },
      { text: 'cafeteria', onSelect: () => { debugUiPrint(); } },
    ]);
    this.renderer.render();
    this.renderer.hide('ui');
    this.renderer.animate(['ui'], 'fadeIn', 50);
    this.state = this.play;
  }

  fieldRefresh() {
    this.renderer.clear();
    this.renderer.render();
    this.renderer.hide('map', 'entities', 'ui');
    this.renderer.animate(['map', 'entities', 'ui'], 'fadeIn', 50);
  }

  fieldMode(delta) {
    // code to load game into field
    // TODO - build code to load field content including potential other players
    // ALSO build code to facilitate multiplayer content
    // determine which multiplayer system to use for a turn based active game

    // get request for current map selected
    this.gameMap.load()
      .then(() => {

        this.renderer.setMode('field');
        this.fieldRefresh();
        this.input.setMode('field');
        this.sio.emit('gameEvent', { signal: 'INIT_MAP', params: [] });
        this.entities[1].setPosObj(this.gameMap.spawn); // load entity position
        this.centerCamera();
      });
    this.state = this.play;
  }

  // ----------------------------------
  // engine helper methods
  // ----------------------------------
  createEntity({ eid, name, textureKey, pos }) {
    const createdEntity = new Entity(eid, name, textureKey);
    if (!!pos) {
      createdEntity.setPosObj(pos);
    }
    this.entities.push(createdEntity);
    this.entityIdMap[eid] = createdEntity;
  }

  centerCamera(updateView = true) {
    this.entities[0].setPos(this.entities[1].pos.x, this.entities[1].pos.y);
    if (updateView) {
      this.renderer.update();
    }
  }
}

export default Engine;
