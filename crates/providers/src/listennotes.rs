use std::{collections::HashMap, env, fs, path::PathBuf};

use anyhow::{anyhow, Result};
use application_utils::get_base_http_client;
use async_trait::async_trait;
use chrono::Datelike;
use common_models::SearchDetails;
use common_utils::{convert_naive_to_utc, PAGE_SIZE, TEMP_DIR};
use dependent_models::SearchResults;
use enums::{MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{
    MetadataDetails, MetadataFreeCreator, MetadataImageForMediaDetails, MetadataSearchItem,
    PartialMetadataWithoutId, PodcastEpisode, PodcastSpecifics,
};
use reqwest::{
    header::{HeaderName, HeaderValue},
    Client,
};
use rust_decimal::Decimal;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use serde_with::{formats::Flexible, serde_as, TimestampMilliSeconds};
use traits::{MediaProvider, MediaProviderLanguages};

static URL: &str = "https://listen-api.listennotes.com/api/v2";
static FILE: &str = "listennotes.json";

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Settings {
    genres: HashMap<i32, String>,
}

#[derive(Debug, Clone)]
pub struct ListennotesService {
    url: String,
    client: Client,
    settings: Settings,
}

impl MediaProviderLanguages for ListennotesService {
    fn supported_languages() -> Vec<String> {
        ["us"].into_iter().map(String::from).collect()
    }

    fn default_language() -> String {
        "us".to_owned()
    }
}

impl ListennotesService {
    pub async fn new(config: &config::PodcastConfig) -> Self {
        let url = env::var("LISTENNOTES_API_URL")
            .unwrap_or_else(|_| URL.to_owned())
            .as_str()
            .to_owned();
        let (client, settings) = get_client_config(&config.listennotes.api_token).await;
        Self {
            url,
            client,
            settings,
        }
    }
}

#[async_trait]
impl MediaProvider for ListennotesService {
    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let mut details = self
            .details_with_paginated_episodes(identifier, None, None)
            .await?;
        #[derive(Serialize, Deserialize, Debug)]
        struct Recommendation {
            id: String,
            title: String,
            thumbnail: Option<String>,
        }
        #[derive(Serialize, Deserialize, Debug)]
        struct RecommendationResp {
            recommendations: Vec<Recommendation>,
        }
        let rec_data: RecommendationResp = self
            .client
            .get(format!(
                "{}/podcasts/{}/recommendations",
                self.url, identifier
            ))
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json()
            .await
            .map_err(|e| anyhow!(e))?;
        details.suggestions = rec_data
            .recommendations
            .into_iter()
            .map(|r| PartialMetadataWithoutId {
                title: r.title,
                image: r.thumbnail,
                identifier: r.id,
                lot: MediaLot::Podcast,
                source: MediaSource::Listennotes,
                is_recommendation: None,
            })
            .collect();

        if let Some(ref mut specifics) = details.podcast_specifics {
            loop {
                if specifics.total_episodes > specifics.episodes.len() {
                    let last_episode = specifics.episodes.last().unwrap();
                    let next_pub_date = last_episode.publish_date;
                    let episode_number = last_episode.number;
                    let new_details = self
                        .details_with_paginated_episodes(
                            identifier,
                            Some(convert_naive_to_utc(next_pub_date).timestamp()),
                            Some(episode_number),
                        )
                        .await?;
                    if let Some(p) = new_details.podcast_specifics {
                        specifics.episodes.extend(p.episodes);
                    }
                } else {
                    break;
                }
            }
        };
        Ok(details)
    }

    async fn metadata_search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let page = page.unwrap_or(1);
        #[serde_as]
        #[derive(Serialize, Deserialize, Debug)]
        struct Podcast {
            title_original: String,
            id: String,
            #[serde_as(as = "Option<TimestampMilliSeconds<i64, Flexible>>")]
            #[serde(rename = "earliest_pub_date_ms")]
            publish_date: Option<DateTimeUtc>,
            image: Option<String>,
        }
        #[derive(Serialize, Deserialize, Debug)]
        struct SearchResponse {
            total: i32,
            results: Vec<Podcast>,
            next_offset: Option<i32>,
        }
        let rsp = self
            .client
            .get(format!("{}/search", self.url))
            .query(&json!({
                "q": query.to_owned(),
                "offset": (page - 1) * PAGE_SIZE,
                "type": "podcast"
            }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;

        let search: SearchResponse = rsp.json().await.map_err(|e| anyhow!(e))?;
        let total = search.total;

        let next_page = search.next_offset.map(|_| page + 1);
        let resp = search
            .results
            .into_iter()
            .map(|r| MetadataSearchItem {
                identifier: r.id,
                title: r.title_original,
                image: r.image,
                publish_year: r.publish_date.map(|r| r.year()),
            })
            .collect_vec();
        Ok(SearchResults {
            details: SearchDetails { total, next_page },
            items: resp,
        })
    }
}

impl ListennotesService {
    // The API does not return all the episodes for a podcast, and instead needs to be
    // paginated through. It also does not return the episode number. So we have to
    // handle those manually.
    pub async fn details_with_paginated_episodes(
        &self,
        identifier: &str,
        next_pub_date: Option<i64>,
        episode_number: Option<i32>,
    ) -> Result<MetadataDetails> {
        #[serde_as]
        #[derive(Serialize, Deserialize, Debug)]
        struct Podcast {
            title: String,
            explicit_content: Option<bool>,
            description: Option<String>,
            listen_score: Option<Decimal>,
            id: String,
            #[serde_as(as = "Option<TimestampMilliSeconds<i64, Flexible>>")]
            #[serde(rename = "earliest_pub_date_ms")]
            publish_date: Option<DateTimeUtc>,
            publisher: Option<String>,
            image: Option<String>,
            episodes: Vec<PodcastEpisode>,
            genre_ids: Vec<i32>,
            total_episodes: usize,
        }
        let  rsp = self
            .client
            .get(format!("{}/podcasts/{}", self.url, identifier))
            .query(&json!({
                "sort": "oldest_first",
                "next_episode_pub_date": next_pub_date.map(|d| d.to_string()).unwrap_or_else(|| "null".to_owned())
            }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let podcast_data: Podcast = rsp.json().await.map_err(|e| anyhow!(e))?;
        Ok(MetadataDetails {
            identifier: podcast_data.id,
            title: podcast_data.title,
            is_nsfw: podcast_data.explicit_content,
            description: podcast_data.description,
            lot: MediaLot::Podcast,
            source: MediaSource::Listennotes,
            creators: Vec::from_iter(podcast_data.publisher.map(|p| MetadataFreeCreator {
                name: p,
                role: "Publishing".to_owned(),
                image: None,
            })),
            genres: podcast_data
                .genre_ids
                .into_iter()
                .filter_map(|g| self.settings.genres.get(&g).cloned())
                .unique()
                .collect(),
            url_images: Vec::from_iter(
                podcast_data
                    .image
                    .map(|a| MetadataImageForMediaDetails { image: a }),
            ),
            publish_year: podcast_data.publish_date.map(|r| r.year()),
            publish_date: podcast_data.publish_date.map(|d| d.date_naive()),
            podcast_specifics: Some(PodcastSpecifics {
                episodes: podcast_data
                    .episodes
                    .into_iter()
                    .enumerate()
                    .map(|(idx, episode)| PodcastEpisode {
                        number: (episode_number.unwrap_or_default() + idx as i32 + 1),
                        runtime: episode.runtime.map(|r| r / 60), // the api responds in seconds
                        ..episode
                    })
                    .collect(),
                total_episodes: podcast_data.total_episodes,
            }),
            provider_rating: podcast_data.listen_score,
            ..Default::default()
        })
    }
}

async fn get_client_config(api_token: &str) -> (Client, Settings) {
    let client = get_base_http_client(Some(vec![(
        HeaderName::from_static("x-listenapi-key"),
        HeaderValue::from_str(api_token).unwrap(),
    )]));
    let path = PathBuf::new().join(TEMP_DIR).join(FILE);
    let settings = if !path.exists() {
        #[derive(Debug, Serialize, Deserialize, Default)]
        #[serde(rename_all = "snake_case")]
        pub struct ListennotesIdAndNamedObject {
            pub id: i32,
            pub name: String,
        }
        #[derive(Debug, Serialize, Deserialize, Default)]
        struct GenreResponse {
            genres: Vec<ListennotesIdAndNamedObject>,
        }
        let rsp = client.get(format!("{}/genres", URL)).send().await.unwrap();
        let data: GenreResponse = rsp.json().await.unwrap_or_default();
        let mut genres = HashMap::new();
        for genre in data.genres {
            genres.insert(genre.id, genre.name);
        }
        let settings = Settings { genres };
        let data_to_write = serde_json::to_string(&settings);
        fs::write(path, data_to_write.unwrap()).unwrap();
        settings
    } else {
        let data = fs::read_to_string(path).unwrap();
        serde_json::from_str(&data).unwrap()
    };
    (client, settings)
}
