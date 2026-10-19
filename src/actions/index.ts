import { openCard } from './open_card'
import { play } from './play'
import { recommend } from './recommend'
import { register } from './registry'
import { torrents } from './torrents'

export { initRecommendations } from './recommend'
export { actionNames, runAction } from './registry'

register(openCard)
register(torrents)
register(play)
register(recommend)
