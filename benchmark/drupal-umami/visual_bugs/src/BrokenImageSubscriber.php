<?php

namespace Drupal\visual_bugs;

use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * b05: the main recipe image points to a file that does not exist (HTTP 404).
 *
 * Changes only the final HTML of that page; render caches stay clean, so the
 * same image on other pages is unaffected.
 */
class BrokenImageSubscriber implements EventSubscriberInterface {

  public static function getSubscribedEvents(): array {
    return [KernelEvents::RESPONSE => ['onResponse', -10]];
  }

  public function onResponse(ResponseEvent $event): void {
    if (!$event->isMainRequest() || _visual_bugs_current() !== 'b05') {
      return;
    }
    $response = $event->getResponse();
    $html = $response->getContent();
    if (!is_string($html)) {
      return;
    }
    // The first Victoria sponge image is the recipe's main image.
    $html = preg_replace_callback('/<img\b[^>]*victoria-sponge-umami[^>]*>/', function ($match) {
      $image = preg_replace('/\s(srcset|sizes)="[^"]*"/', '', $match[0]);
      return preg_replace('/\ssrc="[^"]*"/', ' src="/sites/default/files/visual-bugs-missing.jpg"', $image);
    }, $html, 1);
    $response->setContent($html);
  }

}
