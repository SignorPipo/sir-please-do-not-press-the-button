import {Component, Emitter, Property} from '@wonderlandengine/api';
import {DialogManager} from './dialog-manager'

/**
 * dialog-controller
 */
export class DialogController extends Component {
    static TypeName = 'dialog-controller';
    /* Properties that are configurable in the editor */
    static Properties = {
        dialogManager: Property.object(),
        text: Property.object(),
        responseOneText: Property.object(),
        responseTwoText: Property.object(),
        dialog: Property.string(""),
        charDelay: Property.float(0.025),
        blankDelay: Property.float(0.5),
        audioSource: Property.object(),
        audioSourceCompnent: Property.string(),
        dialogPrefix: Property.string('> '),
        charSoundOne: Property.string(''),
        charSoundTwo: Property.string(''),
        charSoundThree: Property.string(''),
        charSoundSkips: Property.int(3),
    };

    init() {
        this.reset();

        this.responseTexts = new Array();
        this.responseTexts.push(this.responseOneText.getComponent('text'));
        this.responseTexts.push(this.responseTwoText.getComponent('text'));

        this.charSounds = new Array();
        if(this.charSoundOne != '') this.charSounds.push(this.charSoundOne);
        if(this.charSoundTwo != '') this.charSounds.push(this.charSoundTwo);
        if(this.charSoundThree != '') this.charSounds.push(this.charSoundThree);

        this.onHideResponses = new Emitter();
        this.onSetupResponses = new Emitter();
        this.onCharacterPrinted = new Emitter();
    }

    start() {
        this.hideResponses();
    }

    play() {
        if(this.currentStateJSON) return;
        this.reset();
        this.playingDialog = this.dialogManager.getComponent(DialogManager).getDialog(this.dialog);
        this.currentState = "starting";
    }

    stop() {
        this.reset();
    }

    pause() {
        if(this.paused) return;
        this.hideResponses();
        this.paused = true;
        this.textReadPos = 0;
        this.currentText = this.dialogPrefix;
        this.text.getComponent('text').text = this.currentText;
    }

    resume() {
        if(!this.paused) return;
        this.paused = false;
    }

    isWaitingForResponse() {
        if(!this.currentStateJSON) return false;
        var desiredText = this.currentStateJSON["text"];
        return this.textReadPos >= desiredText.length;
    }

    reset() {
        this.paused = false;
        this.currentText = this.dialogPrefix;
        this.currentState = "";
        this.currentStateJSON = null;
        this.textReadPos = 0;
        this.timer = 0.0;
        this.charSoundCounter = 1;

        this.text.getComponent('text').text = this.currentText;
    }

    update(dt) {
        if(this.currentState == "" || this.paused) return;

        if(this.currentState == "starting") {
            this.reset();
            this.currentStateJSON = this.playingDialog["entry"];
            this.currentState = "entry";
            this.handleEvent();
        }

        var desiredText = this.currentStateJSON["text"];
        if(this.textReadPos < desiredText.length) {
            const char = desiredText[this.textReadPos];
            // Hello [s:name] World!
            // s: sound
            // a: animation
            // e: event
            if(char == '[') {
                var firstBracketIndex = this.textReadPos;
                var secondBracketIndex = -1;
                while(true) {
                    ++this.textReadPos;
                    if(this.textReadPos >= desiredText.length) {
                        console.error("Missing ']' in dialog sub event");
                        return;
                    }
                    var nextChar = desiredText[this.textReadPos];
                    if(nextChar == ']') {
                        secondBracketIndex = this.textReadPos;
                        ++this.textReadPos;
                        break;
                    }
                }

                const eventData = desiredText.substring(firstBracketIndex + 1, secondBracketIndex);
                const tokens = eventData.split(':', 2);
                if(tokens.length < 2) {
                    console.error('Expected type and name for dialog sub event');
                    return;
                }

                const type = tokens[0];
                const name = tokens[1];

                switch(type) {
                    case 's': {
                        // Sound
                        this.dialogManager.getComponent(DialogManager).triggerSound(name, this.audioSource.getComponent(this.audioSourceCompnent));
                        break;
                    }

                    case 'a': {
                        // Animation
                        this.dialogManager.getComponent(DialogManager).triggerAnimation(name);
                        break;
                    }

                    case 'e': {
                        // Custom Event
                        this.dialogManager.getComponent(DialogManager).dispatchEvent(name);
                        break;
                    }
                }
                // No need to continue processing the next character, next frame will do that
                return;
            }

            const ignore = char == '_';
            const delay = char == '_' ? this.blankDelay : this.charDelay;

            this.timer += dt;
            this.charSoundTimer += dt;
            if(this.timer < delay) {
                return;
            }
            this.timer -= delay;

            if(!ignore) {
                this.currentText += char;
                this.characterPrinted(char);
            }
            ++this.textReadPos;

            if(this.textReadPos >= desiredText.length) {
                this.setupResponses();
            }
        } else {
            var autoAdvanceTime = this.currentStateJSON["autoAdvanceAfter"];
            if(autoAdvanceTime) {
                this.timer += dt;
                if(this.timer < autoAdvanceTime) return;
                this.timer -= autoAdvanceTime;
                this.advance(-1);
            }
        }

        this.text.getComponent('text').text = this.currentText;
    }

    advance(choiceIndex) {
        if(this.paused) {
            console.warn("Cannot advance a paused dialog!");
            return;
        }
        if(!this.currentStateJSON) return;

        // Reset responses
        this.hideResponses();

        var responses = this.currentStateJSON["responses"];

        var jump = responses ? null : this.currentStateJSON["jump"];
        if(!jump && responses && choiceIndex != -1) {
            var response = responses[choiceIndex];
            if(!response) {
                console.log("Cannot advance with invalid response!");
                return;
            }
            jump = response["jump"];
        }

        // Cannot advance without a response
        if(!jump && responses) {
            console.log("Cannot advance current dialog without response!");
            return;
        }

        if(!jump && jump != "") {
            var keys = Object.keys(this.playingDialog);
            var index = keys.indexOf(this.currentState);
            this.reset();

            if(index + 1 >= keys.length) {
                // Done!
                this.dialogManager.getComponent(DialogManager).onEnd(this);
                return;
            }
            this.currentState = keys[index + 1];
            this.currentStateJSON = this.playingDialog[this.currentState];
            this.handleEvent();
            return;
        }

        this.reset();
        this.currentStateJSON = this.playingDialog[jump];
        this.currentState = jump;
        this.handleEvent();
    }

    hideResponses() {
        this.onHideResponses.notify();
        for(var i = 0; i < this.responseTexts.length; ++i) {
            //this.responseTexts[i].active = false;
            //this.responseTexts[i].text = "";
        }
    }

    setupResponses() {
        var responses = this.currentStateJSON["responses"];
        if(!responses) return;
        this.onSetupResponses.notify();
        for(var i = 0; i < responses.length; ++i) {
            var response = responses[i]["text"];
            //this.responseTexts[i].active = true;
            this.responseTexts[i].text = response;
        }
    }

    handleEvent() {
        const event = this.currentStateJSON["event"];
        if(!event) return;
        this.dialogManager.getComponent(DialogManager).dispatchEvent(event);
    }

    characterPrinted(char) {
        this.onCharacterPrinted.notify(char);
        if(this.charSounds.length == 0) return;
        const randomSound = Math.floor(Math.random() * this.charSounds.length);
        --this.charSoundCounter;
        if(this.charSoundCounter > 0) return;
        this.dialogManager.getComponent(DialogManager).triggerSound(this.charSounds[randomSound], this.audioSource.getComponent(this.audioSourceCompnent));
        this.charSoundCounter = this.charSoundSkips;
    }
}
