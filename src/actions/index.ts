import { openCard } from './open_card'
import { play } from './play'
import { register } from './registry'
import { torrents } from './torrents'

export { actionNames, runAction } from './registry'

register(openCard)
register(torrents)
register(play)
