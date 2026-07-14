import { ComponentFixture, TestBed } from '@angular/core/testing';

import { XDogComponent } from './xdog';

describe('XDogComponent', () => {
  let component: XDogComponent;
  let fixture: ComponentFixture<XDogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [XDogComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(XDogComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
